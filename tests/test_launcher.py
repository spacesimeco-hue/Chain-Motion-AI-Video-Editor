import unittest
from unittest.mock import patch
import run

class LauncherTests(unittest.TestCase):
    def launch(self, args):
        with patch('sys.argv', ['run.py', *args]), patch('run.uvicorn.run') as server, patch('run.lan_addresses',return_value=['192.168.1.12']), patch('builtins.print'):
            run.main()
            return server.call_args.kwargs

    def test_default_remains_local(self):
        self.assertEqual(self.launch([]),dict(host='127.0.0.1',port=8787))

    def test_lan_and_custom_port(self):
        self.assertEqual(self.launch(['--lan','--port','8888']),dict(host='0.0.0.0',port=8888))

    def test_specific_interface(self):
        self.assertEqual(self.launch(['--host','192.168.1.12'])['host'],'192.168.1.12')
