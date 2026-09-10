import copy
import os
import tempfile
import unittest
from unittest.mock import patch
from editor.store import Store, project, segment, check_project, encode_spec, segment_context, apply_generated_take

class ImportedSegments(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        with patch.dict(os.environ, FRAMEFORGE_DATA=self.tmp.name):
            from editor import server
        self.server=server
        self.store=Store(self.tmp.name)
        self.patch=patch.object(server,'store',self.store);self.patch.start()
        self.p=next(iter(self.store.data['projects'].values()))
        self.s=self.p['scenes'][0]['segments'][0]
        self.s.update(type='video',main='video',duration=3,trim_in=.5)
        self.store.data['assets']['video']=dict(id='video',kind='video',duration=4,name='Test')
        self.assets=self.store.data['assets']
    def tearDown(self):
        self.patch.stop();self.tmp.cleanup()
    def test_trim_snapshot_invalidated_by_edits(self):
        self.s['encoded_latent']={'path':'saved','source':encode_spec(self.s,self.assets)}
        self.assertIsNotNone(segment_context(self.s,self.assets))
        for key,value in [('trim_in',.75),('duration',2),('main','other'),('width',640)]:
            changed=copy.deepcopy(self.s);changed[key]=value
            self.assertIsNone(segment_context(changed,self.assets))
    def test_mixed_queue_encodes_then_continues(self):
        nxt=segment();nxt.update(prompt='Continue motion',connected=True)
        self.p['scenes'][0]['segments'].append(nxt)
        jobs=self.server.queue(dict(project_id=self.p['id'],segment_ids=[self.s['id'],nxt['id']]))
        self.assertEqual([j['kind'] for j in jobs],['encode','segment'])
        self.assertEqual(jobs[0]['spec']['trim_in'],.5)
        self.assertEqual(jobs[0]['spec']['duration'],3)
        self.assertEqual(jobs[1]['dependency'],jobs[0]['id'])
    def test_segment_encode_and_source_bounds(self):
        job=self.server.encode('video',dict(project_id=self.p['id'],segment_id=self.s['id']))
        self.assertEqual(job['spec'],encode_spec(self.s,self.assets))
        self.s['duration']=4
        with self.assertRaisesRegex(ValueError,'extends beyond'):encode_spec(self.s,self.assets)
    def test_stale_active_encoding_is_not_used(self):
        self.server.encode('video',dict(project_id=self.p['id'],segment_id=self.s['id']))
        self.s['trim_in']=0
        nxt=segment();nxt.update(prompt='Continue',connected=True)
        self.p['scenes'][0]['segments'].append(nxt)
        jobs=self.server.queue(dict(project_id=self.p['id'],segment_ids=[nxt['id']]))
        self.assertEqual([j['kind'] for j in jobs],['encode','segment'])
        self.assertEqual(jobs[0]['spec']['trim_in'],0)
        self.assertEqual(jobs[1]['dependency'],jobs[0]['id'])

    def test_matching_active_encoding_reused(self):
        existing=self.server.encode('video',dict(project_id=self.p['id'],segment_id=self.s['id']))
        nxt=segment();nxt.update(prompt='Continue',connected=True)
        self.p['scenes'][0]['segments'].append(nxt)
        jobs=self.server.queue(dict(project_id=self.p['id'],segment_ids=[nxt['id']]))
        self.assertEqual(len(jobs),1)
        self.assertEqual(jobs[0]['dependency'],existing['id'])

    def test_matching_latent_needs_no_encoding(self):
        self.s['encoded_latent']=dict(source=encode_spec(self.s,self.assets),width=608,height=352,server=self.store.data['settings']['comfy_url'])
        nxt=segment();nxt.update(prompt='Continue',connected=True)
        self.p['scenes'][0]['segments'].append(nxt)
        jobs=self.server.queue(dict(project_id=self.p['id'],segment_ids=[nxt['id']]))
        self.assertEqual(len(jobs),1)
        self.assertIsNotNone(jobs[0]['context'])

    def test_new_take_replaces_main_and_resets_old_trim(self):
        self.s.update(takes=['video'],encoded_latent={'source':'old'})
        assets={**self.assets,'new':dict(kind='video',duration=3.75)}
        apply_generated_take(self.s,['new'],assets,{'duration':3})
        self.assertEqual(self.s['main'],'new')
        self.assertEqual(self.s['takes'],['video','new'])
        self.assertEqual(self.s['trim_in'],0)
        self.assertEqual(self.s['duration'],3.75)
        self.assertNotIn('encoded_latent',self.s)

    def test_automatic_segment_seeds_are_resolved_once_per_job(self):
        self.s.update(type='generation',prompt='Test',randomize_seed=True,seed=42)
        body=dict(project_id=self.p['id'],segment_ids=[self.s['id']])
        with patch('editor.server.secrets.randbelow',side_effect=[123,456]) as rng:
            first=self.server.queue(body)[0]
            second=self.server.queue(body)[0]
            self.assertEqual(rng.call_count,2)
        self.assertEqual([first['spec']['seed'],second['spec']['seed']],[123,456])
        self.assertEqual(self.s['seed'],42)
        self.s['randomize_seed']=False
        self.assertEqual(self.server.queue(body)[0]['spec']['seed'],42)

    def test_speech_auto_seed_and_fixed_seed(self):
        self.assets.update(image=dict(kind='image'),audio=dict(kind='audio',duration=1))
        body=dict(prompt='Hello',duration=4,image_id='image',audio_id='audio',seed=42,randomize_seed=True)
        with patch('editor.server.secrets.randbelow',return_value=789):
            self.assertEqual(self.server.speech(copy.deepcopy(body))['spec']['seed'],789)
        body['randomize_seed']=False
        self.assertEqual(self.server.speech(body)['spec']['seed'],42)
