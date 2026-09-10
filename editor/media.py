import json
import os
import re
import shutil
import subprocess
import zipfile
from pathlib import Path


def ffmpeg():
    binary = os.environ.get('FFMPEG_BINARY') or shutil.which('ffmpeg')
    if binary:
        return binary
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        raise ValueError('FFmpeg is unavailable. Install requirements.txt or set FFMPEG_BINARY.')


def run(args):
    proc = subprocess.run([ffmpeg(), '-hide_banner', '-nostdin', '-y', *map(str, args)], capture_output=True, timeout=1800)
    if proc.returncode:
        raise ValueError('Media processing failed: ' + proc.stderr.decode(errors='replace')[-1800:])
    return proc


def probe(path):
    p = subprocess.run([ffmpeg(), '-hide_banner', '-i', str(path)], capture_output=True, timeout=30)
    text = p.stderr.decode(errors='replace')
    match = re.search(r'Duration: (\d+):(\d+):([\d.]+)', text)
    duration = sum(float(x) * m for x, m in zip(match.groups(), [3600, 60, 1])) if match else 0
    size = re.search(r'Video:.*?\b(\d{2,5})x(\d{2,5})\b', text)
    return {'duration': duration, 'has_audio': 'Audio:' in text,
            'width': int(size[1]) if size else 0, 'height': int(size[2]) if size else 0}


def normalize_video(src, out, width, height, duration=None, start=0):
    meta = probe(src)
    args = ['-ss', start, '-i', src]
    if not meta['has_audio']:
        args += ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
    args += ['-map', '0:v:0', '-map', '0:a:0' if meta['has_audio'] else '1:a:0']
    args += ['-vf', f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24',
             '-af', 'aresample=48000,apad', '-t', duration or meta['duration'], '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
             '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le' if Path(out).suffix=='.mov' else 'aac', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', out]
    run(args)


def trim_audio(src, out, start, end):
    run(['-ss', start, '-i', src, '-t', end-start, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', out])


def thumbnail(src, out, kind):
    if kind == 'image':
        from PIL import Image
        with Image.open(src) as im:
            im.thumbnail((480, 280))
            im.convert('RGB').save(out, 'JPEG')
    elif kind == 'video':
        run(['-i', src, '-frames:v', '1', '-vf', 'scale=480:-2', out])


def waveform(src):
    p = run(['-i', src, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'])
    import array
    values = array.array('h', p.stdout)
    step = max(1, len(values)//180)
    return [round(max((abs(v) for v in values[i:i+step]), default=0)/32768, 3) for i in range(0, len(values), step)][:180]


def export_sequence(project, assets, folder, mode):
    folder.mkdir(parents=True, exist_ok=True)
    manifest, clips = [], []
    for scene in project['scenes']:
        for seg in scene['segments']:
            if not seg.get('main') or seg['main'] not in assets:
                raise ValueError(f'Choose a main video for {scene["name"]} / {seg["name"]} before exporting.')
            a = assets[seg['main']]
            if a['kind'] != 'video':
                raise ValueError('Main takes must be videos.')
            if a['duration'] + 0.05 < seg['duration'] + seg.get('trim_in', 0):
                raise ValueError(f'{seg["name"]}: source is shorter than its timeline duration. Trim the segment or generate a longer take.')
            name = f'{len(clips)+1:03d}_' + re.sub(r'[^\w-]+', '_', scene['name']+'_'+seg['name'])[:90] + ('.mp4' if mode=='clips' else '.mov')
            output = folder / name
            render_duration=round(seg['duration']*24)/24
            normalize_video(a['_path'], output, project['width'], project['height'], render_duration, seg.get('trim_in', 0))
            clips.append(output)
            manifest.append({'scene': scene['name'], 'segment': seg['name'], 'file': name, 'duration': render_duration, 'prompt': seg['prompt'], 'context_frames': seg['overlap']})
    if not clips:
        raise ValueError('Add segments before exporting.')
    (folder/'manifest.json').write_text(json.dumps(manifest, indent=2))
    if mode == 'clips':
        result = folder/'individual-clips.zip'
        with zipfile.ZipFile(result, 'w', zipfile.ZIP_STORED) as z:
            for p in clips + [folder/'manifest.json']:
                z.write(p, p.name)
    else:
        (folder/'concat.txt').write_text('\n'.join(f"file '{p.name}'" for p in clips))
        result = folder/'finished-video.mp4'
        run(['-f', 'concat', '-safe', '0', '-i', folder/'concat.txt', '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', result])
    return result
