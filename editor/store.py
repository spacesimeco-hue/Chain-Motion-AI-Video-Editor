import copy
import json
import os
import threading
import time
import uuid
from pathlib import Path
from .workflows import DEFAULT_MODELS


def uid():
    return uuid.uuid4().hex


def segment(name='Segment 01'):
    return dict(id=uid(), name=name, prompt='', duration=3.5, overlap=22, connected=False,
                refs=[], main=None, takes=[], trim_in=0, seed=42, steps=20, width=608, height=352, continuation=None)


def segment_source(seg):
    return dict(asset_id=seg.get('main'), trim_in=seg.get('trim_in',0),
                duration=seg['duration'], width=seg['width'], height=seg['height'])


def segment_context(seg, assets):
    saved=seg.get('encoded_latent')
    if saved and saved.get('source')==segment_source(seg):
        return saved
    a=assets.get(seg.get('main'),{})
    if seg.get('trim_in',0)==0 and abs(seg['duration']-a.get('duration',0))<0.03:
        return a.get('latent')
    return None


def encode_spec(seg, assets):
    source=segment_source(seg)
    a=assets.get(source['asset_id'],{})
    if a.get('kind')!='video':
        raise ValueError('Choose a main video before encoding this segment.')
    if source['trim_in']+source['duration']>a['duration']+0.03:
        raise ValueError('The segment extends beyond its source video. Shorten it before encoding.')
    return source


def apply_generated_take(seg, videos, assets, spec):
    seg['takes'] = list(dict.fromkeys(seg['takes']+videos))
    if videos:
        seg['main'] = videos[-1]
        seg['trim_in'] = 0
        seg.pop('encoded_latent', None)
        # Keep the complete newly generated take and its latent endpoint aligned.
        seg['duration'] = assets[videos[-1]]['duration']


def project(name='Untitled film'):
    return dict(id=uid(), name=name, version=0, width=608, height=352, fps=24,
                scenes=[dict(id=uid(), name='Scene 01', prompt='', refs=[], segments=[segment()])])


def check_project(p, assets):
    if not isinstance(p.get('name'), str) or not p['name'].strip():
        raise ValueError('Give your project a name.')
    if p.get('fps') != 24:
        raise ValueError('H3 motion context uses 24 fps.')
    if any(not isinstance(p.get(k), int) or p[k] < 32 or p[k] > 4096 or p[k] % 32 for k in ['width', 'height']):
        raise ValueError('Resolution must be multiples of 32, from 32 to 4096.')
    ids = set()
    for scene in p.get('scenes', []):
        for obj in [scene, *scene['segments']]:
            if not isinstance(obj.get('id'), str) or obj['id'] in ids:
                raise ValueError('Scene and segment IDs must be unique.')
            ids.add(obj['id'])
        for s in scene['segments']:
            if not 0.25 <= float(s['duration']) <= (86400 if s.get('type')=='video' else 120) or s['overlap'] not in [22, 39, 56]:
                raise ValueError('Duration must be at least 0.25 seconds (maximum 120 for generated segments or 86400 for imported videos); overlap must be 22, 39 or 56 frames.')
            if not 1 <= int(s['steps']) <= 100 or not 0 <= int(s['seed']) <= 2**53-1:
                raise ValueError('Steps must be 1–100 and seed a nonnegative safe integer.')
            if not 0 <= float(s.get('trim_in', 0)) <= 86400:
                raise ValueError('Trim start must be nonnegative.')
            for kind, limit in [('image',9),('video',3),('audio',3)]:
                refs = set(scene['refs'] + s['refs'])
                if any(a not in assets for a in refs):
                    raise ValueError('A referenced asset is missing.')
                if sum(assets[a]['kind']==kind for a in refs) > limit:
                    raise ValueError(f'{s["name"]} exceeds {limit} {kind} references, including shared scene assets.')
            if s.get('main') and (s['main'] not in assets or assets[s['main']]['kind'] != 'video'):
                raise ValueError('Main take must be an existing video asset.')
            s['width'], s['height'] = p['width'], p['height']


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        for f in ['assets','exports','graphs','latents']:
            (self.root/f).mkdir(exist_ok=True)
        self.lock = threading.RLock()
        self.file = self.root/'library.json'
        if self.file.exists():
            self.data = json.loads(self.file.read_text())
        else:
            p = project()
            self.data = dict(projects={p['id']:p}, assets={}, jobs=[], settings=dict(comfy_url='http://192.168.88.253:8188', models=DEFAULT_MODELS.copy()))
            self.save()
        # Never re-submit a prompt after a crash. Resume history monitoring if possible.
        for j in self.data['jobs']:
            if j['status'] in ('preparing','running','cancelling','submitting'):
                if j.get('prompt_id'):
                    j['status'] = 'recovering'
                else:
                    j['status'] = 'failed'
                    j['error'] = 'Editor stopped during preparation/submission. Check ComfyUI history before retrying.'
        self.save()

    def save(self):
        with self.lock:
            tmp = self.file.with_suffix('.tmp')
            tmp.write_text(json.dumps(self.data, indent=2))
            os.replace(tmp, self.file)

    def snapshot(self):
        with self.lock:
            return copy.deepcopy(self.data)

    def asset_path(self, a):
        path = (self.root / a['file']).resolve()
        if not path.is_relative_to(self.root/'assets'):
            raise ValueError('Invalid asset path.')
        return path

    def update_job(self, jid, **fields):
        with self.lock:
            j = next(j for j in self.data['jobs'] if j['id']==jid)
            j.update(fields, updated=time.time())
            self.save()
            return copy.deepcopy(j)
