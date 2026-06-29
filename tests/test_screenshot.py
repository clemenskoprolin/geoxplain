import json
import urllib.request
from pathlib import Path

import numpy as np

from geoxplain import GeoXplainWidget, GeoXplain


def _array(value: float = 1.0) -> np.ndarray:
    return np.full((2, 4), value, dtype=np.float32)


def _viewer_data_url(index_url: str) -> str:
    return index_url.rsplit('/', 1)[0] + '/viewer_data.json'


def test_viewer_screenshot_uses_default_path_and_dimensions(monkeypatch, tmp_path):
    calls = {}

    def fake_capture(payload, out_path, *, width, height, timeout, launch_state=None):
        calls.update({
            'payload': payload,
            'out_path': Path(out_path),
            'width': width,
            'height': height,
            'timeout': timeout,
            'launch_state': launch_state,
        })
        Path(out_path).write_bytes(b'png')
        return Path(out_path)

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr('geoxplain.viewer.capture_viewer_screenshot', fake_capture)

    viewer = GeoXplain(out_path=str(tmp_path / 'viewer_data.json'))
    viewer.add_attribution(_array(), pressure_level=850)

    path = viewer.screenshot(timeout=12.5)

    assert path == calls['out_path']
    assert path.parent == Path('screenshots')
    assert path.name.startswith('geoxplain-screenshot-')
    assert calls['width'] == 1100
    assert calls['height'] == 820
    assert calls['timeout'] == 12.5
    assert calls['launch_state'] is None
    assert calls['payload']['methods']


def test_viewer_screenshot_custom_path_dimensions_and_launch_state(monkeypatch, tmp_path):
    calls = {}

    def fake_capture(payload, out_path, *, width, height, timeout, launch_state=None):
        calls.update({
            'out_path': Path(out_path),
            'width': width,
            'height': height,
            'launch_state': launch_state,
        })
        Path(out_path).write_bytes(b'png')
        return Path(out_path)

    monkeypatch.setattr('geoxplain.viewer.capture_viewer_screenshot', fake_capture)
    viewer = GeoXplain(out_path=str(tmp_path / 'viewer_data.json'))
    viewer.add_attribution(_array(), pressure_level=850)
    launch_state = {'selectedMethod': 'saliency'}

    path = viewer.screenshot(
        tmp_path / 'custom.png',
        width=640,
        height=360,
        output_dir=tmp_path / 'ignored',
        launch_state=launch_state,
    )

    assert path == tmp_path / 'custom.png'
    assert calls['out_path'] == tmp_path / 'custom.png'
    assert calls['width'] == 640
    assert calls['height'] == 360
    assert calls['launch_state'] is launch_state


def test_viewer_open_serves_current_export_and_closes(tmp_path):
    viewer = GeoXplain(out_path=tmp_path / 'viewer_data.json')
    viewer.add_attribution(_array(), pressure_level=850)

    handle = viewer.open(open_browser=False)
    try:
        assert handle.url.startswith('http://127.0.0.1:')
        with urllib.request.urlopen(_viewer_data_url(handle.url), timeout=2.0) as response:
            payload = json.loads(response.read())

        assert payload['appTitle'] == 'GeoXplain'
        assert payload['methods']
    finally:
        handle.close()

    handle.close()


def test_viewer_open_can_launch_webbrowser(monkeypatch, tmp_path):
    opened = []
    monkeypatch.setattr('geoxplain.viewer.webbrowser.open', lambda url: opened.append(url) or True)

    viewer = GeoXplain(out_path=tmp_path / 'viewer_data.json')
    viewer.add_attribution(_array(), pressure_level=850)

    handle = viewer.open()
    try:
        assert opened == [handle.url]
    finally:
        handle.close()


def test_widget_browser_export_uses_packaged_browser_bundle(tmp_path):
    export_dir = tmp_path / 'browser-export'
    widget = GeoXplainWidget(config_dir=export_dir)
    try:
        widget.add_attribution({'z-2': _array()}, method='Saliency')

        browser_config = dict(widget.browser_config)
        assert browser_config['enabled'] is True
        assert browser_config['href'].startswith('http://127.0.0.1:')
        assert 'live=1' in browser_config['href']

        assert (export_dir / 'index.html').exists()
        assert (export_dir / 'assets' / 'index.js').exists()
        assert (export_dir / 'assets' / 'index.css').exists()

        with (export_dir / 'viewer_data.json').open(encoding='utf-8') as handle:
            payload = json.load(handle)
        assert payload['methods']
        assert not (Path('geoxplain') / 'static' / 'viewer_data.json').exists()
    finally:
        widget.close()


def test_widget_screenshot_uses_reported_surface_and_launch_state(monkeypatch, tmp_path):
    calls = {}

    def fake_capture(payload, out_path, *, width, height, timeout, launch_state=None):
        calls.update({
            'payload': payload,
            'out_path': Path(out_path),
            'width': width,
            'height': height,
            'timeout': timeout,
            'launch_state': launch_state,
        })
        Path(out_path).write_bytes(b'png')
        return Path(out_path)

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr('geoxplain.widget.capture_viewer_screenshot', fake_capture)
    monkeypatch.setattr(GeoXplainWidget, '_refresh_browser_export', lambda self, payload=None: None)

    widget = GeoXplainWidget(height=620)
    try:
        widget.add_attribution({'z-2': _array()}, method='Saliency')
        launch_state = {
            'selectedMethod': 'saliency',
            'timestampIndex': 0,
            'viewMode': 'map',
            'mapType': 'topo',
        }
        widget._handle_frontend_message(
            widget,
            {
                'kind': 'geoxplain:viewer_state',
                'launchState': launch_state,
                'surface': {'width': 777.2, 'height': 333.4},
                'ready': True,
            },
            [],
        )

        path = widget.screenshot(output_dir=tmp_path / 'shots', timeout=4.0)

        assert path == calls['out_path']
        assert path.parent == tmp_path / 'shots'
        assert calls['width'] == 777
        assert calls['height'] == 333
        assert calls['timeout'] == 4.0
        assert calls['launch_state'] is launch_state
        assert calls['payload']['methods']
        assert widget._last_viewer_ready is True
    finally:
        widget.close()


def test_widget_screenshot_falls_back_to_widget_height(monkeypatch, tmp_path):
    calls = {}

    def fake_capture(payload, out_path, *, width, height, timeout, launch_state=None):
        calls.update({'width': width, 'height': height, 'launch_state': launch_state})
        Path(out_path).write_bytes(b'png')
        return Path(out_path)

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr('geoxplain.widget.capture_viewer_screenshot', fake_capture)
    monkeypatch.setattr(GeoXplainWidget, '_refresh_browser_export', lambda self, payload=None: None)

    widget = GeoXplainWidget(height=512)
    try:
        widget.add_attribution({'z-2': _array()}, method='Saliency')
        widget.screenshot(output_dir=tmp_path)

        assert calls['width'] == 1100
        assert calls['height'] == 512
        assert calls['launch_state'] is None
    finally:
        widget.close()
