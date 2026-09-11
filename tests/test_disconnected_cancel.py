import tempfile
import unittest
from unittest.mock import Mock,patch
from editor.store import Store
from editor.comfy import JobRunner

class DisconnectedCancellationTests(unittest.TestCase):
    def test_offline_cancel_is_terminal_and_stops_monitor(self):
        with tempfile.TemporaryDirectory() as tmp:
            s=Store(tmp)
            j=dict(id='a',status='running',prompt_id='p',comfy_url='http://localhost:8188')
            s.data['jobs']=[j]
            runner=JobRunner(s,None)
            with patch('editor.comfy.Comfy.request',side_effect=ValueError('Disconnected')):
                runner.cancel('a')
            self.assertEqual(j['status'],'cancelled')
            self.assertTrue(j['remote_cancel_unconfirmed'])
            client=Mock()
            self.assertIsNone(runner.monitor(j,client,None))
            client.request.assert_not_called()

    def test_disconnect_during_poll_then_cancel_advances_worker(self):
        with tempfile.TemporaryDirectory() as tmp:
            s=Store(tmp)
            j=dict(id='a',status='recovering',prompt_id='p',comfy_url='http://localhost:8188')
            second=dict(id='b',status='queued')
            s.data['jobs']=[j,second]
            runner=JobRunner(s,None)
            client=Mock()
            def disconnected(*args,**kwargs):
                with patch('editor.comfy.Comfy.request',side_effect=ValueError('Offline')):
                    runner.cancel('a')
                raise ValueError('Offline')
            client.request.side_effect=disconnected
            processed=[]
            def run(job):
                processed.append(job['id'])
                if job['id']=='a':
                    runner.monitor(job,client,None)
                else:
                    s.update_job('b',status='completed')
                    runner.stop.set()
            with patch.object(runner,'run',side_effect=run),patch.object(runner.stop,'wait',return_value=False):
                runner.loop()
            self.assertEqual(processed,['a','b'])
            self.assertEqual(j['status'],'cancelled')
            self.assertEqual(second['status'],'completed')

    def test_cancel_owned_remote_prompt_still_interrupts(self):
        with tempfile.TemporaryDirectory() as tmp:
            s=Store(tmp);s.data['jobs']=[dict(id='a',status='running',prompt_id='p',comfy_url='http://localhost:8188')]
            with patch('editor.comfy.Comfy.request',side_effect=[{}, {'queue_running':[[0,'p']]}, {}]) as request:
                JobRunner(s,None).cancel('a')
            self.assertEqual(request.call_args.args,('/interrupt',{'prompt_id':'p'}))
            self.assertEqual(s.data['jobs'][0]['status'],'cancelled')
