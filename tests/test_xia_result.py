import io
import json
import zipfile

import numpy as np
import pytest

from geoxplain.xia_result import load_xia_result


def _write_bundle(path, *, method):
    meta = {
        'format_version': 2,
        'method': method,
        'frames': [{
            'timestamp': '2026-01-01T00:00:00Z',
            'target': {},
            'diverging': False,
            'attributions_index': {'q': ['z-2']},
        }],
    }
    buffer = io.BytesIO()
    np.save(buffer, np.ones((2, 4), dtype=np.float32))
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('meta.json', json.dumps(meta))
        archive.writestr('f0__q__z-2.npy', buffer.getvalue())


def test_load_xia_result_appends_missing_suffix(tmp_path):
    saved_path = tmp_path / 'result.xia.npz'
    _write_bundle(saved_path, method='saliency')

    result = load_xia_result(tmp_path / 'result')

    assert result.method == 'saliency'
    np.testing.assert_array_equal(
        result.frames[0].attributions['q']['z-2'],
        np.ones((2, 4), dtype=np.float32),
    )


def test_load_xia_result_prefers_existing_exact_path(tmp_path):
    exact_path = tmp_path / 'result'
    _write_bundle(exact_path, method='exact')
    _write_bundle(tmp_path / 'result.xia.npz', method='suffixed')

    result = load_xia_result(exact_path)

    assert result.method == 'exact'


def test_load_xia_result_missing_path_reports_appended_name(tmp_path):
    with pytest.raises(FileNotFoundError, match=r'missing\.xia\.npz'):
        load_xia_result(tmp_path / 'missing')
