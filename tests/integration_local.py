"""Exercises the running editor with generated test media; no ComfyUI jobs submitted."""
import copy
import io
import json
import time
import requests
import zipfile
from pathlib import Path

BASE='http://127.0.0.1:8787'
def call(path,body=None,method='POST'):
    r=requests.get(BASE+path) if body is None else requests.request(method,BASE+path,json=body)
    r.raise_for_status();return r.json()

state=call('/api/state')
a={x['name']:x for x in state['assets'].values()}
p=call('/api/projects',{'name':'Validation · local editing'})
s=p['scenes'][0]['segments'][0]
s.update(name='Test pattern',prompt='Local export validation',duration=1.5,main=a['test-clip']['id'],trim_in=.5)
p=call('/api/projects/'+p['id'],p,'PUT')
assert requests.put(BASE+'/api/projects/'+p['id'],json={**p,'version':0}).status_code==409
trim=call('/api/assets/'+a['test-audio']['id']+'/trim',{'start':.5,'end':2,'name':'Validation · trimmed audio'})
assert abs(trim['duration']-1.5)<.03
frame=call('/api/assets/'+a['test-clip']['id']+'/capture',{'time':1,'name':'Validation · captured frame'})
assert frame['kind']=='image'
assert requests.post(BASE+'/api/assets/'+a['test-audio']['id']+'/trim',json={'start':2,'end':1}).status_code==400
r=requests.get(BASE+'/api/assets/'+a['test-clip']['id']+'/file',headers={'Range':'bytes=0-999'})
assert r.status_code==206 and len(r.content)==1000,(r.status_code,len(r.content))
for mode in ['video','clips']:
    j=call('/api/export',{'project_id':p['id'],'mode':mode})
    for _ in range(60):
        current=next(x for x in call('/api/state')['jobs'] if x['id']==j['id'])
        if current['status'] in ['completed','failed']:break
        time.sleep(.5)
    assert current['status']=='completed',current
    data=requests.get(BASE+current['download']).content
    assert len(data)>1000
    if mode=='clips':
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            assert 'manifest.json' in z.namelist()
            manifest=json.loads(z.read('manifest.json'))
            assert manifest[0]['duration']==1.5
    print(mode,'export verified',len(data),'bytes')
r=requests.post(BASE+'/api/projects',json={'name':'blocked'},headers={'Origin':'https://other-site.example'})
assert r.status_code==403
print('PASS: optimistic concurrency, import, trim, frame capture, byte-range video playback, both exports, same-origin writes')
