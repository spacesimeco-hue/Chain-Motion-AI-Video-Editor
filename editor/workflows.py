"""API graphs derived from the two supplied workflows, without UI-only nodes."""
import math

DEFAULT_MODELS = {
    'h3_model': 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
    'h3_clip': 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    'h3_video_vae': 'minimax_h3_video_vae_fp16.safetensors',
    'h3_audio_vae': 'minimax_h3_audio_vae_fp32.safetensors',
    'ltx_checkpoint': 'ltx-2.3-22b-dev-fp8.safetensors',
    'ltx_encoder': 'gemma_3_12B_it_fp4_mixed.safetensors',
    'ltx_distilled_lora': 'ltx-2.3-22b-distilled-lora-384-1.1.safetensors',
}


def h3_frames(seconds, overlap=0):
    # H3 accepts 5 + 17k frames. Round UP so the delivered duration never shrinks.
    target = math.ceil(seconds * 24) + overlap
    return max(5, 5 + math.ceil((target - 5) / 17) * 17)


class Graph(dict):
    def add(self, key, kind, **inputs):
        self[str(key)] = {'class_type': kind, 'inputs': inputs}
        return [str(key), 0]


def save_video(g, key, video, prefix, schema=None):
    args = dict(video=video, filename_prefix=prefix, format='mp4')
    info = (schema or {}).get('SaveVideo', {}).get('input', {}).get('required', {}).get('format', [])
    if info and info[0] == 'COMFY_DYNAMICCOMBO_V3':
        args['format.codec'] = 'h264'
    else:
        args['codec'] = 'h264'
    return g.add(key, 'SaveVideo', **args)


def h3_graph(segment, refs, models, prefix, context=None, schema=None):
    g = Graph()
    model = g.add('model', 'UNETLoader', unet_name=models['h3_model'], weight_dtype='default')
    clip = g.add('clip', 'CLIPLoader', clip_name=models['h3_clip'], type='stable_diffusion', device='default')
    vae = g.add('vae', 'VAELoader', vae_name=models['h3_video_vae'])
    avae = g.add('avae', 'VAELoader', vae_name=models['h3_audio_vae'])
    inputs = dict(clip=clip, vae=vae, audio_vae=avae, prompt=segment['prompt'],
                  width=segment['width'], height=segment['height'],
                  length=h3_frames(segment['duration'], segment['overlap'] if context else 0), ref_image_size='match')
    for kind, limit in [('image', 9), ('video', 3), ('audio', 3)]:
        items = [a for a in refs if a['kind'] == kind]
        if len(items) > limit:
            raise ValueError(f'A segment supports at most {limit} {kind} references, including scene assets.')
        for i, a in enumerate(items):
            key = f'{kind}_{i}'
            if kind == 'image':
                inputs[f'ref_images.ref_image_{i}'] = g.add(key, 'LoadImage', image=a['remote'])
            elif kind == 'audio':
                inputs[f'ref_audios.ref_audio_{i}'] = g.add(key, 'LoadAudio', audio=a['remote'])
            else:
                v = g.add(key, 'LoadVideo', file=a['remote'])
                c = g.add(key + '_parts', 'GetVideoComponents', video=v)
                inputs[f'ref_videos.ref_video_{i}'] = c
                if a.get('has_audio', True):
                    inputs[f'ref_video_audios.ref_video_audio_{i}'] = [c[0], 1]
    cond = g.add('reference', 'MiniMaxH3ReferenceToVideo', **inputs)
    ctx = dict(conditioning=cond, vae=vae, latent=['reference', 1], context_length=str(segment['overlap']),
               audio_context_length=24, audio_vae=avae)
    if context:
        ctx['context_latent'] = g.add('previous', 'MiniMaxH3MotionContextLoadLatent', latent_path=context, clip_index=1)
    conditioning = g.add('context', 'MiniMaxH3MotionContext', **ctx)
    noise = g.add('noise', 'RandomNoise', noise_seed=segment['seed'])
    guider = g.add('guider', 'BasicGuider', model=model, conditioning=conditioning)
    sampler = g.add('sampler', 'KSamplerSelect', sampler_name='res_multistep')
    sigmas = g.add('sigmas', 'BasicScheduler', model=model, scheduler='simple', steps=segment['steps'], denoise=1.0)
    latent = g.add('sample', 'SamplerCustomAdvanced', noise=noise, guider=guider, sampler=sampler, sigmas=sigmas, latent_image=['reference', 1])
    g.add('save_latent', 'MiniMaxH3MotionContextSaveLatent', latent=latent, filename_prefix=prefix + '/latent', clip_index=1)
    video = g.add('decode', 'VAEDecode', samples=latent, vae=vae)
    audio = g.add('decode_audio', 'VAEDecodeAudio', samples=latent, vae=avae)
    trimmed = g.add('trim', 'MiniMaxH3MotionContextTrim', images=video, audio=audio, trim_frames=['context', 1], fps=24.0, match_tail=True)
    v = g.add('video', 'CreateVideo', images=trimmed, audio=['trim', 1], fps=24.0)
    save_video(g, 'save_video', v, prefix + '/video', schema)
    return g


def speech_graph(spec, image, audio, models, prefix, schema=None):
    """Supplied LTX workflow extended with a locked voice prefix and generated tail.

    Build a full-duration nested AV latent first, then replace its audio with the
    masked short reference. Native LTXVConcatAVLatent fits that reference to the
    existing stream, zero-padding the tail and assigning noise mask=1 to it.
    """
    reference_duration = float(spec['reference_duration'])
    duration = float(spec['duration'])
    if not 0 < reference_duration < duration:
        raise ValueError('Generation length must be longer than the voice reference.')
    g = Graph()
    cp = g.add('checkpoint', 'CheckpointLoaderSimple', ckpt_name=models['ltx_checkpoint'])
    clip = g.add('clip', 'LTXAVTextEncoderLoader', text_encoder=models['ltx_encoder'], ckpt_name=models['ltx_checkpoint'], device='default')
    avae = g.add('avae', 'LTXVAudioVAELoader', ckpt_name=models['ltx_checkpoint'])
    model = g.add('distilled', 'LoraLoaderModelOnly', model=cp, lora_name=models['ltx_distilled_lora'], strength_model=0.5)
    positive = g.add('positive', 'CLIPTextEncode', clip=clip, text=spec['prompt'])
    negative = g.add('negative', 'CLIPTextEncode', clip=clip, text='distorted speech, noise, music')
    conditioning = g.add('condition', 'LTXVConditioning', positive=positive, negative=negative, frame_rate=24.0)
    length = 1 + math.ceil(duration * 24 / 8) * 8
    full_audio = g.add('empty_audio', 'LTXVEmptyLatentAudio', frames_number=length, frame_rate=24.0, batch_size=1, audio_vae=avae)
    reference = g.add('audio', 'LoadAudio', audio=audio)
    encoded = g.add('encode_audio', 'LTXVAudioVAEEncode', audio=reference, audio_vae=avae)
    mask = g.add('mask', 'SolidMask', value=0.0, width=32, height=32)
    locked_audio = g.add('audio_mask', 'SetLatentNoiseMask', samples=encoded, mask=mask)
    # Primitive links allow the native 1x1 spatial latent at 32x32.
    size = g.add('size', 'PrimitiveInt', value=32)
    empty = g.add('empty_video', 'EmptyLTXVLatentVideo', width=size, height=size, length=length, batch_size=1)
    img = g.add('image', 'LoadImage', image=image)
    scaled = g.add('resize', 'ImageScale', image=img, upscale_method='area', width=32, height=32, crop='center')
    video = g.add('image_condition', 'LTXVImgToVideoInplace', vae=['checkpoint', 2], image=scaled, latent=empty, strength=0.7, bypass=False)
    full_av = g.add('full_av', 'LTXVConcatAVLatent', video_latent=video, audio_latent=full_audio)
    latent = g.add('av', 'LTXVConcatAVLatent', video_latent=full_av, audio_latent=locked_audio)
    noise = g.add('noise', 'RandomNoise', noise_seed=spec['seed'])
    guide = g.add('guide', 'CFGGuider', model=model, positive=conditioning, negative=['condition', 1], cfg=1.0)
    sampler = g.add('sampler', 'KSamplerSelect', sampler_name='euler')
    sigmas = g.add('sigmas', 'ManualSigmas', sigmas='1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0')
    sampled = g.add('sample', 'SamplerCustomAdvanced', noise=noise, guider=guide, sampler=sampler, sigmas=sigmas, latent_image=latent)
    separated = g.add('separate', 'LTXVSeparateAVLatent', av_latent=sampled)
    decoded = g.add('decode_audio', 'LTXVAudioVAEDecode', samples=['separate', 1], audio_vae=avae)
    trimmed_audio = g.add('trim_prefix_audio', 'TrimAudioDuration', audio=decoded, start_index=reference_duration, duration=duration-reference_duration)
    g.add('save_audio', 'SaveAudio', audio=trimmed_audio, filename_prefix=prefix + '/speech')
    frames = g.add('decode_video', 'VAEDecode', samples=separated, vae=['checkpoint', 2])
    trimmed_video = g.add('trim_prefix_video', 'ImageFromBatch', image=frames, batch_index=round(reference_duration*24), length=max(1,round((duration-reference_duration)*24)))
    v = g.add('video', 'CreateVideo', images=trimmed_video, audio=trimmed_audio, fps=24.0)
    save_video(g, 'save_video', v, prefix + '/driver', schema)
    return g


def encode_graph(video, models, prefix):
    # Merge the encoded streams using the same native nested AV representation.
    g = Graph()
    v = g.add('video', 'LoadVideo', file=video)
    parts = g.add('parts', 'GetVideoComponents', video=v)
    vae = g.add('vae', 'VAELoader', vae_name=models['h3_video_vae'])
    avae = g.add('avae', 'VAELoader', vae_name=models['h3_audio_vae'])
    vl = g.add('encode_video', 'VAEEncode', pixels=parts, vae=vae)
    al = g.add('encode_audio', 'VAEEncodeAudio', audio=['parts', 1], vae=avae)
    av = g.add('concat', 'LTXVConcatAVLatent', video_latent=vl, audio_latent=al)
    g.add('save_latent', 'MiniMaxH3MotionContextSaveLatent', latent=av, filename_prefix=prefix + '/latent', clip_index=1)
    return g


def validate_graph(graph, schema):
    missing = sorted({n['class_type'] for n in graph.values()} - schema.keys())
    if missing:
        raise ValueError('Install missing ComfyUI nodes: ' + ', '.join(missing))
    for key, n in graph.items():
        required = schema[n['class_type']].get('input', {}).get('required', {})
        for name, rule in required.items():
            if name not in n['inputs']:
                raise ValueError(f'{key}: required input {name} is missing')
            value = n['inputs'][name]
            if isinstance(value, list):
                if len(value) != 2 or value[0] not in graph:
                    raise ValueError(f'{key}.{name}: broken graph connection')
                continue
            choices = rule[0] if isinstance(rule[0], list) else (rule[1].get('options') if len(rule) > 1 and rule[0] == 'COMBO' else None)
            if choices and value not in choices and n['class_type'] not in ('LoadImage', 'LoadAudio', 'LoadVideo'):
                raise ValueError(f'{key}.{name}: {value!r} is not installed or supported. Update Settings.')
