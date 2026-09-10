import copy
import json
import threading
import time
import uuid
from urllib.parse import urlparse
import requests
from . import media
from .store import uid, segment_source, apply_generated_take
from .workflows import h3_graph, speech_graph, encode_graph, validate_graph, h3_frames


class Comfy:
    def __init__(self, url):
        u = urlparse(url)
        if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password or u.query or u.fragment:
            raise ValueError('Use a ComfyUI URL such as http://192.168.88.253:8188')
        self.url = url.rstrip('/')

    def request(self, path, body=None, timeout=15):
        try:
            r = requests.get(self.url+path, timeout=timeout) if body is None else requests.post(self.url+path, json=body, timeout=timeout)
            if not r.ok:
                raise ValueError(f'ComfyUI {path}: {r.status_code} {r.text[:2400]}')
            return r.json()
        except requests.RequestException as e:
            raise ValueError(f'Cannot reach ComfyUI at {self.url}: {e}') from e

    def upload(self, path):
        with open(path, 'rb') as f:
            r = requests.post(self.url+'/upload/image', files={'image': (path.name, f)}, data={'type':'input', 'subfolder':'frameforge', 'overwrite':'false'}, timeout=300)
        if not r.ok:
            raise ValueError('ComfyUI asset upload failed: '+r.text[:500])
        d = r.json()
        return (d.get('subfolder','')+'/' if d.get('subfolder') else '')+d['name']

    def download(self, info, path):
        with requests.get(self.url+'/view', params=info, stream=True, timeout=300) as r:
            r.raise_for_status()
            with open(path, 'wb') as f:
                for chunk in r.iter_content(1024*1024):
                    f.write(chunk)


class JobRunner:
    def __init__(self, store, add_asset):
        self.store, self.add_asset = store, add_asset
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.loop, daemon=True)

    def start(self):
        self.thread.start()

    def cancelled(self, jid):
        return next(j['status'] for j in self.store.snapshot()['jobs'] if j['id']==jid) in ('cancelled','cancelling')

    def loop(self):
        while not self.stop.is_set():
            jobs = self.store.snapshot()['jobs']
            j = next((j for j in jobs if j['status'] in ('queued','recovering')), None)
            if not j:
                self.stop.wait(0.5)
                continue
            try:
                self.run(j)
            except Exception as e:
                self.store.update_job(j['id'], status='cancelled' if self.cancelled(j['id']) else 'failed', error=str(e), finished=time.time())

    def run(self, j):
        s = self.store
        c = Comfy(j['comfy_url'])
        if j['status'] != 'recovering':
            with s.lock:
                if self.cancelled(j['id']):
                    s.update_job(j['id'], status='cancelled', finished=time.time())
                    return
                s.update_job(j['id'], status='preparing', started=time.time(), stage='Checking workflow and references')
            graph, latent = self.prepare(j, c)
            if self.cancelled(j['id']):
                s.update_job(j['id'], status='cancelled', finished=time.time())
                return
            schema = c.request('/object_info', timeout=90)
            validate_graph(graph, schema)
            (s.root/'graphs'/f'{j["id"]}.json').write_text(json.dumps(graph, indent=2))
            j['prompt_id'] = str(uuid.UUID(j['id']))
            with s.lock:
                if self.cancelled(j['id']):
                    s.update_job(j['id'], status='cancelled', finished=time.time())
                    return
                s.update_job(j['id'], status='submitting', latent=latent, prompt_id=j['prompt_id'], stage='Submitting to ComfyUI')
            # Connect before submission to retain early progress events.
            ws = self.open_ws(c, j['id'])
            if self.cancelled(j['id']):
                if ws:
                    ws.close()
                s.update_job(j['id'], status='cancelled', finished=time.time())
                return
            result = c.request('/prompt', {'prompt':graph, 'client_id':j['id'], 'prompt_id':j['prompt_id']}, timeout=120)
            if result.get('node_errors'):
                raise ValueError(json.dumps(result['node_errors']))
            j['prompt_id'] = result['prompt_id']
            j['latent'] = latent
            was_cancelled = self.cancelled(j['id'])
            s.update_job(j['id'], prompt_id=j['prompt_id'], status='cancelling' if was_cancelled else 'running', stage='Waiting for ComfyUI')
            if was_cancelled:
                self.cancel(j['id'])
        else:
            ws = self.open_ws(c, j['id'])
            s.update_job(j['id'], status='running', stage='Reconnected; checking saved ComfyUI history')
        try:
            history = self.monitor(j, c, ws)
            if history is None:
                return
            if self.cancelled(j['id']):
                s.update_job(j['id'], status='cancelled', finished=time.time())
                return
            s.update_job(j['id'], stage='Saving media and latent locally')
            results = []
            for node, out in history.get('outputs', {}).items():
                for key in ('images','gifs','audio','videos'):
                    for item in out.get(key, []):
                        if not isinstance(item, dict) or not item.get('filename'):
                            continue
                        ext = item['filename'].rsplit('.',1)[-1].lower()
                        if ext not in ('mp4','webm','mov','wav','flac','mp3','ogg'):
                            continue
                        target = s.root/'assets'/f'{uid()}.{ext}'
                        c.download({k:item[k] for k in ('filename','subfolder','type') if k in item}, target)
                        a = self.add_asset(target, j['name'] + (' · driver' if j['kind']=='speech' and ext in ('mp4','webm') else ' · take'), 'generated')
                        a['job_id'] = j['id']
                        if a['kind']=='video' and j['kind']=='segment':
                            overlap=j['spec']['overlap'] if (j.get('context') or j.get('dependency')) else 0
                            a['frames']=h3_frames(j['spec']['duration'],overlap)-overlap
                            a['duration']=a['frames']/24
                        if a['kind']=='video' and j['kind']=='speech':
                            import math
                            a['frames']=max(1,round((j['spec']['duration']-j['spec'].get('reference_duration',0))*24))
                            a['duration']=a['frames']/24
                        if j.get('latent') and a['kind']=='video':
                            a['latent'] = copy.deepcopy(j['latent'])
                            j['latent']['delivered_duration'] = a['duration']
                        with s.lock:
                            s.data['assets'][a['id']].update(a)
                            s.save()
                        results.append(a['id'])
            if j.get('latent'):
                latent = j['latent']
                target = s.root/'latents'/f'{j["id"]}.safetensors'
                try:
                    c.download({'filename':'latent_00001.safetensors','subfolder':latent['folder'],'type':'output'}, target)
                    latent['local'] = str(target.relative_to(s.root))
                    latent['downloaded'] = True
                except Exception as e:
                    latent['downloaded'] = False
                    latent['warning'] = f'Latent saved on ComfyUI; local download unavailable: {e}'
                with s.lock:
                    for aid in results:
                        if s.data['assets'][aid]['kind']=='video':
                            s.data['assets'][aid]['latent'] = copy.deepcopy(latent)
                    if j['kind']=='encode':
                        a = s.data['assets'].get(j['spec']['asset_id'])
                        if j.get('segment_id'):
                            latent['source']=copy.deepcopy(j['spec'])
                            p=s.data['projects'].get(j['project_id'])
                            seg=next((v for sc in p['scenes'] for v in sc['segments'] if v['id']==j['segment_id']),None) if p else None
                            if seg and segment_source(seg)==j['spec']:
                                seg['encoded_latent']=copy.deepcopy(latent)
                                p['version']+=1
                        elif a:
                            a['latent'] = copy.deepcopy(latent)
                    s.save()
            if j['kind'] != 'encode' and not results:
                raise ValueError('ComfyUI finished but returned no downloadable video or audio. Check history and the saved graph.')
            if j['kind']=='segment':
                with s.lock:
                    p = s.data['projects'].get(j['project_id'])
                    if p:
                        seg = next((v for scene in p['scenes'] for v in scene['segments'] if v['id']==j['segment_id']), None)
                        if seg:
                            videos = [a for a in results if s.data['assets'][a]['kind']=='video']
                            apply_generated_take(seg, videos, s.data['assets'], j['spec'])
                            p['version'] += 1
                            s.save()
            s.update_job(j['id'], status='completed', stage='Complete', progress=100, results=results, latent=j.get('latent'), finished=time.time())
        finally:
            if ws:
                ws.close()

    def open_ws(self, c, client):
        try:
            import websocket
            return websocket.create_connection(c.url.replace('http','ws',1)+'/ws?clientId='+client, timeout=1)
        except Exception:
            return None

    def monitor(self, j, c, ws):
        last_poll, misses = 0, 0
        while not self.stop.is_set():
            if ws:
                try:
                    raw = ws.recv()
                    if isinstance(raw, str):
                        event = json.loads(raw)
                        d, typ = event.get('data',{}), event.get('type')
                        if d.get('prompt_id',j['prompt_id'])==j['prompt_id']:
                            if typ=='progress':
                                self.store.update_job(j['id'], progress=round(100*d.get('value',0)/max(1,d.get('max',1))), stage=f'Sampling {d.get("value",0)} / {d.get("max",0)}', node=d.get('node'))
                            elif typ=='executing' and d.get('node'):
                                self.store.update_job(j['id'], stage='Executing '+str(d['node']), node=d['node'], progress=None)
                except Exception:
                    pass
            else:
                self.stop.wait(1)
            if time.time()-last_poll < 3:
                continue
            last_poll = time.time()
            try:
                history = c.request('/history/'+j['prompt_id']).get(j['prompt_id'])
                if history:
                    status = history.get('status', {})
                    if status.get('status_str') == 'error':
                        raise RuntimeError(json.dumps(status.get('messages',[]))[-4000:])
                    if status.get('completed'):
                        return history
                q = c.request('/queue')
                present = any(row[1]==j['prompt_id'] for row in q.get('queue_running',[])+q.get('queue_pending',[]))
                if not present and self.cancelled(j['id']):
                    self.store.update_job(j['id'],status='cancelled',finished=time.time())
                    return None
                if present:
                    current = next(x for x in self.store.snapshot()['jobs'] if x['id']==j['id'])
                    if current.get('connection_error'):
                        self.store.update_job(j['id'], connection_error=None, stage='Reconnected · waiting for ComfyUI' if current.get('stage','').startswith('Connection lost') else current.get('stage'))
                misses = 0 if present else misses+1
                if misses > 10:
                    raise RuntimeError('Job is absent from ComfyUI queue and history. It may have been removed externally; no automatic resubmission was made.')
            except ValueError as e:
                self.store.update_job(j['id'], stage='Connection lost; retrying history', connection_error=str(e))
                self.stop.wait(3)
        return None

    def prepare(self, j, c):
        s = self.store
        snap = s.snapshot()
        spec = j['spec']
        prefix = 'frameforge/'+j['id']
        schema = c.request('/object_info', timeout=90)
        latent = {'path':prefix+'/latent_00001.safetensors', 'folder':prefix, 'server':c.url,
                  'width':spec.get('width',608), 'height':spec.get('height',352), 'fps':24, 'model':j['models']['h3_model']}
        def upload(aid, normalize=False):
            if self.cancelled(j['id']):
                raise ValueError('Cancelled')
            a = copy.deepcopy(snap['assets'][aid])
            p = s.asset_path(a)
            if normalize and a['kind']=='video':
                target = s.root/'assets'/f'prepared-{j["id"]}-{aid}.mp4'
                media.normalize_video(p,target,spec.get('width',608),spec.get('height',352),
                                      spec.get('duration') if j['kind']=='encode' else None,
                                      spec.get('trim_in',0) if j['kind']=='encode' else 0)
                p = target
                a['has_audio'] = True
            a['remote'] = c.upload(p)
            return a
        if j['kind']=='segment':
            refs = [upload(aid,True) for aid in spec['refs']]
            context = None
            if j.get('dependency'):
                dep = next(x for x in snap['jobs'] if x['id']==j['dependency'])
                if dep['status']!='completed' or not dep.get('latent'):
                    raise ValueError('Previous segment did not complete. Retry the chain after resolving that job.')
                ctx = dep['latent']
            else:
                ctx = j.get('context')
            if ctx:
                if (ctx['width'],ctx['height']) != (spec['width'],spec['height']):
                    raise ValueError('Motion context resolution differs from this segment. Match project resolution or start a new chain.')
                if ctx['server'].rstrip('/') != c.url:
                    raise ValueError('This latent belongs to another ComfyUI server. Restore it on this server or encode the video again.')
                context = ctx['path']
            return h3_graph(spec,refs,j['models'],prefix,context,schema), latent
        if j['kind']=='speech':
            return speech_graph(spec,upload(spec['image_id'])['remote'],upload(spec['audio_id'])['remote'],j['models'],prefix,schema), None
        if j.get('segment_id'):
            latent['source']=copy.deepcopy(spec)
        a = upload(spec['asset_id'],True)
        return encode_graph(a['remote'],j['models'],prefix), latent

    def cancel(self, jid):
        snap = self.store.snapshot()
        j = next(x for x in snap['jobs'] if x['id']==jid)
        if j['status'] in ('completed','failed','cancelled'):
            return j
        self.store.update_job(jid,status='cancelling' if j['status']!='queued' else 'cancelled')
        if not j.get('prompt_id'):
            return
        c = Comfy(j['comfy_url'])
        c.request('/queue', {'delete':[j['prompt_id']]})
        # Interrupt only if our prompt is the active job. Never clear the shared queue.
        running = c.request('/queue').get('queue_running',[])
        if any(row[1]==j['prompt_id'] for row in running):
            c.request('/interrupt', {'prompt_id':j['prompt_id']})
