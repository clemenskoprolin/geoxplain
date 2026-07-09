import contextlib
import io
import json
import tempfile
import time
import unittest
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from unittest import mock

import numpy as np

import geoxplain._base as base_module
import geoxplain._progress as progress_module
from geoxplain import GeoXplain


@dataclass
class SyntheticFrame:
    timestamp: str
    attributions: dict
    diverging: bool = False
    target: dict | None = None

    def as_widget_dict(self) -> dict:
        return self.target or {}


@dataclass
class SyntheticResult:
    method: str
    frames: list
    layer_labels: dict = field(default_factory=dict)
    meta: dict = field(default_factory=dict)


@dataclass
class SyntheticOverlayFrame:
    timestamp: str
    data: np.ndarray


@dataclass
class SyntheticOverlay:
    variable: str = 'q'
    level: int | None = 850
    label: str = 'Specific Humidity 850 hPa'
    unit: str = 'kg/kg'
    colormap: Any = 'viridis'
    visible: bool = False
    frames: list = field(default_factory=list)


def _result(method: str, timestamp: str, attributions: dict, *, target=None, layer_labels=None) -> SyntheticResult:
    return SyntheticResult(
        method=method,
        frames=[SyntheticFrame(timestamp=timestamp, attributions=attributions, target=target)],
        layer_labels=layer_labels or {},
    )


def _array(value: float = 1.0) -> np.ndarray:
    return np.full((2, 4), value, dtype=np.float32)


def _read_json(path: Path) -> dict:
    with path.open() as f:
        return json.load(f)


class GeoXplainXiaResultTests(unittest.TestCase):
    def test_viewer_exports_default_app_title_and_subtitle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'

            GeoXplain(out_path=str(out_path)).add_attribution(_array(), pressure_level=850)

            data = _read_json(out_path)
            self.assertEqual(data['appTitle'], 'GeoXplain')
            self.assertEqual(data['appSubtitle'], 'Interactive geospatial attribution viewer')

    def test_viewer_accepts_custom_app_title_and_subtitle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(
                out_path=str(out_path),
                title='Storm Case Study',
                subtitle='Alpine precipitation attribution',
            )

            viewer.add_attribution(_array(), pressure_level=850)

            data = _read_json(out_path)
            self.assertEqual(data['appTitle'], 'Storm Case Study')
            self.assertEqual(data['appSubtitle'], 'Alpine precipitation attribution')

    def test_viewer_title_setters_reexport(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))

            viewer.add_attribution(_array(), pressure_level=850)
            viewer.set_title('Operational Diagnostics')
            viewer.set_subtitle(None)

            data = _read_json(out_path)
            self.assertEqual(data['appTitle'], 'Operational Diagnostics')
            self.assertEqual(data['appSubtitle'], '')

    def test_set_options_exports_viewer_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))

            viewer.set_options(
                view_mode='contours',
                map_type='globe',
                basemap='satellite',
                smooth_imported_grids=False,
            )
            viewer.add_attribution(_array(), pressure_level=850)

            data = _read_json(out_path)
            self.assertIs(data['contours'], True)
            self.assertEqual(
                data['viewerOptions'],
                {
                    'viewMode': 'globe',
                    'mapType': 'satellite',
                    'smoothImportedGrids': False,
                },
            )

    def test_clear_writes_empty_payload_and_keeps_configuration(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(
                out_path=str(out_path),
                title='Configured',
                subtitle='Still here',
            )

            viewer.set_options(view_mode='contours')
            viewer.add_attribution(_array(), pressure_level=850)
            viewer.add_overlay(_array(), name='Temperature')
            viewer.clear()

            self.assertTrue(out_path.exists())
            data = _read_json(out_path)
            self.assertEqual(data['methods'], {})
            self.assertNotIn('overlays', data)
            self.assertEqual(data['appTitle'], 'Configured')
            self.assertEqual(data['appSubtitle'], 'Still here')
            self.assertIs(data['contours'], True)

    def test_export_can_write_to_explicit_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            configured_path = Path(tmp) / 'viewer_data.json'
            explicit_path = Path(tmp) / 'other.json'
            viewer = GeoXplain(out_path=str(configured_path))

            viewer.add_attribution(_array(), pressure_level=850)
            returned_path = viewer.export(explicit_path)

            self.assertEqual(returned_path, explicit_path)
            self.assertTrue(explicit_path.exists())
            self.assertTrue(configured_path.exists())

    def test_xia_result_rejects_raw_attribution_arguments(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))
            result = _result(
                'saliency',
                '2020-01-01T22:00:00Z',
                {'zwd': {'z-2': _array()}},
            )

            with self.assertRaisesRegex(TypeError, 'method cannot be specified'):
                viewer.add_attribution(result, method='Integrated Gradients')
            with self.assertRaisesRegex(TypeError, 'level cannot be specified'):
                viewer.add_attribution(result, level='z-2')
            with self.assertRaisesRegex(TypeError, 'target cannot be specified'):
                viewer.add_attribution(result, target=None)

    def test_xia_result_accepts_norm_and_payload_supports_rescaling(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))
            result = _result(
                'saliency',
                '2020-01-01T22:00:00Z',
                {'zwd': {'z-2': _array(2.0), 'sfc': _array(0.5)}},
            )

            viewer.add_attribution(result, norm='all-methods')

            data = _read_json(out_path)
            self.assertEqual(data['version'], 5)
            self.assertEqual(data['normalization'], 'all-methods')
            (method,) = data['methods'].values()
            (frame,) = method['frames']
            self.assertEqual(frame['levels']['z-2']['max_abs'], 2.0)
            self.assertEqual(frame['levels']['sfc']['max_abs'], 0.5)

            with self.assertRaisesRegex(ValueError, 'norm must be one of'):
                viewer.add_attribution(result, norm='invalid')

    def test_raw_attribution_dispatch_is_strict(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))

            with self.assertRaisesRegex(ValueError, 'exactly one of level or pressure_level'):
                viewer.add_attribution(_array())
            with self.assertRaisesRegex(TypeError, 'level must be a string'):
                viewer.add_attribution(_array(), level=3)  # type: ignore[arg-type]
            with self.assertRaisesRegex(TypeError, 'label cannot be specified'):
                viewer.add_attribution({'z-2': _array()}, label='850 hPa')

    def test_overlay_dispatch_is_strict(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))

            with self.assertRaisesRegex(TypeError, 'variable cannot be specified'):
                viewer.add_overlay(_array(), variable='temperature')
            with self.assertRaisesRegex(TypeError, 'timestamps must be a sequence'):
                viewer.add_overlay(_array(), timestamps='2020-01-01T00:00:00Z')  # type: ignore[arg-type]

    def test_clear_attributions_preserves_overlays(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))

            viewer.add_attribution(_array(), pressure_level=850)
            viewer.add_overlay(_array(), name='Temperature')
            viewer.clear_attributions()

            data = _read_json(out_path)
            self.assertEqual(data['methods'], {})
            self.assertIn('temperature', data['overlays'])

    def test_clear_overlays_preserves_attributions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))

            viewer.add_attribution(_array(), pressure_level=850)
            viewer.add_overlay(_array(), name='Temperature')
            viewer.clear_overlays()

            data = _read_json(out_path)
            self.assertTrue(data['methods'])
            self.assertNotIn('overlays', data)

    def test_remove_export_deletes_configured_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))

            viewer.add_attribution(_array(), pressure_level=850)
            self.assertTrue(out_path.exists())
            self.assertIsNone(viewer.remove_export())
            self.assertFalse(out_path.exists())

    def test_default_viewer_does_not_write_on_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            viewer = GeoXplain()
            viewer.add_attribution(_array(), pressure_level=850)

            self.assertIsNone(viewer.export_path)
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_export_without_path_raises(self) -> None:
        viewer = GeoXplain()
        viewer.add_attribution(_array(), pressure_level=850)

        with self.assertRaisesRegex(ValueError, 'No export path configured'):
            viewer.export()

    def test_export_to_explicit_path_for_in_memory_viewer(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'sub' / 'viewer_data.json'
            viewer = GeoXplain()
            viewer.add_attribution(_array(), pressure_level=850)

            returned = viewer.export(out_path)

            self.assertEqual(returned, out_path)
            self.assertTrue(out_path.exists())
            self.assertIn('methods', _read_json(out_path))

    def test_remove_export_is_noop_without_configured_path(self) -> None:
        viewer = GeoXplain()
        viewer.add_attribution(_array(), pressure_level=850)

        self.assertIsNone(viewer.remove_export())

    def test_export_browser_writes_bundle_and_data(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp) / 'case'
            viewer = GeoXplain()
            viewer.add_attribution(_array(), pressure_level=850)

            index_html = viewer.export_browser(out_dir)

            self.assertEqual(index_html, out_dir / 'index.html')
            self.assertTrue(index_html.exists())
            self.assertIn('methods', _read_json(out_dir / 'viewer_data.json'))

    def test_single_level_and_mapping_sources(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))

            viewer.add_attribution(_array(), level='sfc', method='Surface Saliency', label='Surface')
            viewer.add_attribution(
                {'z-0': _array(), 'z-2': _array()},
                method='Mapped Saliency',
                layer_labels={'z-0': '1000 hPa', 'z-2': '850 hPa'},
            )

            data = _read_json(out_path)
            labels = {method['label'] for method in data['methods'].values()}
            self.assertEqual(labels, {'Surface Saliency', 'Mapped Saliency'})
            mapped = data['methods']['mapped-saliency']['frames'][0]['levels']
            self.assertEqual(mapped['z-0']['label'], '1000 hPa')
            self.assertEqual(mapped['z-2']['label'], '850 hPa')

    def test_constructor_result_writes_viewer_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            result = _result(
                'saliency',
                '2020-01-01T22:00:00Z',
                {'zwd': {'z-2': _array()}},
                target={'lat': 46.2, 'lon': 8.8},
                layer_labels={'z-2': '850 hPa'},
            )

            GeoXplain(out_path=str(out_path), result=result)

            data = _read_json(out_path)
            methods = list(data['methods'].values())
            self.assertEqual(len(methods), 1)
            self.assertEqual(methods[0]['label'], 'saliency (zwd)')
            frame = methods[0]['frames'][0]
            self.assertEqual(frame['timestamp'], '2020-01-01T22:00:00Z')
            self.assertEqual(frame['target']['type'], 'point')
            self.assertIn('z-2', frame['levels'])
            self.assertEqual(frame['levels']['z-2']['label'], '850 hPa')
            self.assertEqual(frame['levels']['z-2']['z'], 2)
            self.assertEqual(methods[0]['colorScheme'], {'type': 'preset', 'name': 'default'})

    def test_constructor_result_exports_preset_colormap(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            result = _result(
                'saliency',
                '2020-01-01T22:00:00Z',
                {'zwd': {'z-2': _array()}},
            )

            GeoXplain(out_path=str(out_path), result=result, colormap='coolwarm')

            data = _read_json(out_path)
            method = next(iter(data['methods'].values()))
            self.assertEqual(method['colorScheme'], {'type': 'preset', 'name': 'coolwarm'})

    def test_add_attribution_exports_custom_colormap_stops(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))

            viewer.add_attribution(
                _result('saliency', '2020-01-01T22:00:00Z', {'zwd': {'z-2': _array()}}),
                colormap=['#06c', '#f7f7f7', '#b2182b'],
            )

            data = _read_json(out_path)
            method = next(iter(data['methods'].values()))
            self.assertEqual(
                method['colorScheme'],
                {
                    'type': 'custom',
                    'stops': [
                        {'position': 0.0, 'color': '#0066cc'},
                        {'position': 0.5, 'color': '#f7f7f7'},
                        {'position': 1.0, 'color': '#b2182b'},
                    ],
                },
            )

    def test_invalid_colormap_specs_raise(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))

            with self.assertRaises(ValueError):
                viewer.add_attribution(_array(), pressure_level=850, colormap='not-a-preset')

            with self.assertRaises(ValueError):
                viewer.add_attribution(_array(), pressure_level=850, colormap=['#fff'])

            with self.assertRaises(ValueError):
                viewer.add_attribution(
                    _array(),
                    pressure_level=850,
                    colormap=[(0.0, '#000000'), (0.0, '#ffffff')],
                )

    def test_add_attribution_appends_frames_for_new_timestamps(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))

            viewer.add_attribution(_result('saliency', '2020-01-01T22:00:00Z', {'zwd': {'z-2': _array(1)}}))
            viewer.add_attribution(_result('saliency', '2020-01-01T23:00:00Z', {'zwd': {'z-2': _array(2)}}))

            data = _read_json(out_path)
            method = next(iter(data['methods'].values()))
            self.assertEqual(
                [frame['timestamp'] for frame in method['frames']],
                ['2020-01-01T22:00:00Z', '2020-01-01T23:00:00Z'],
            )

    def test_multiframe_bundle_lands_on_timeline(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            bundle = SyntheticResult(
                method='saliency',
                frames=[
                    SyntheticFrame('2020-01-01T22:00:00Z', {'zwd': {'z-2': _array(1)}}),
                    SyntheticFrame('2020-01-01T23:00:00Z', {'zwd': {'z-2': _array(2)}}),
                ],
            )

            GeoXplain(out_path=str(out_path), result=bundle)

            data = _read_json(out_path)
            method = next(iter(data['methods'].values()))
            self.assertEqual(
                [frame['timestamp'] for frame in method['frames']],
                ['2020-01-01T22:00:00Z', '2020-01-01T23:00:00Z'],
            )

    def test_xia_result_progress_is_silent_before_delay(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            result = _result('saliency', '2020-01-01T22:00:00Z', {'zwd': {'z-2': _array(1)}})
            stdout = io.StringIO()
            stderr = io.StringIO()

            with (
                mock.patch.object(progress_module, '_ATTRIBUTION_PROGRESS_INITIAL_DELAY_SECONDS', 60.0),
                contextlib.redirect_stdout(stdout),
                contextlib.redirect_stderr(stderr),
            ):
                GeoXplain(out_path=str(out_path)).add_attribution(result)

            self.assertEqual(stdout.getvalue(), '')
            self.assertEqual(stderr.getvalue(), '')

    def test_xia_result_progress_prints_to_stdout_after_delay_and_counts_maps(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            result = SyntheticResult(
                method='saliency',
                frames=[
                    SyntheticFrame(
                        '2020-01-01T22:00:00Z',
                        {
                            'zwd': {'z-2': _array(1), 'z-3': _array(2)},
                            'q': {'sfc': _array(3)},
                        },
                    ),
                    SyntheticFrame('2020-01-01T23:00:00Z', {'zwd': {'z-2': _array(4)}}),
                ],
            )
            original_preprocess = base_module.preprocess_array
            calls = 0

            def slow_first_preprocess(source):
                nonlocal calls
                calls += 1
                if calls == 1:
                    time.sleep(0.06)
                return original_preprocess(source)

            stdout = io.StringIO()
            stderr = io.StringIO()
            with (
                mock.patch.object(progress_module, '_ATTRIBUTION_PROGRESS_INITIAL_DELAY_SECONDS', 0.01),
                mock.patch.object(progress_module, '_ATTRIBUTION_PROGRESS_UPDATE_INTERVAL_SECONDS', 1.0),
                mock.patch.object(base_module, 'preprocess_array', side_effect=slow_first_preprocess),
                contextlib.redirect_stdout(stdout),
                contextlib.redirect_stderr(stderr),
            ):
                GeoXplain(out_path=str(out_path)).add_attribution(result)

            self.assertIn('Processing layer 1/4', stdout.getvalue().splitlines())
            self.assertEqual(stderr.getvalue(), '')

    def test_xia_result_progress_updates_are_throttled(self) -> None:
        reporter = progress_module._DelayedLayerProgressReporter(total_layers=3)
        reporter._started_at = 0.0
        reporter.begin_layer()
        stdout = io.StringIO()
        stderr = io.StringIO()

        with (
            contextlib.redirect_stdout(stdout),
            contextlib.redirect_stderr(stderr),
            mock.patch.object(progress_module, '_ATTRIBUTION_PROGRESS_INITIAL_DELAY_SECONDS', 30.0),
            mock.patch.object(progress_module, '_ATTRIBUTION_PROGRESS_UPDATE_INTERVAL_SECONDS', 15.0),
        ):
            self.assertFalse(reporter._emit_if_due(now=29.9))
            self.assertTrue(reporter._emit_if_due(now=30.0))
            reporter.begin_layer()
            self.assertFalse(reporter._emit_if_due(now=44.9))
            self.assertTrue(reporter._emit_if_due(now=45.0))

        self.assertEqual(
            stdout.getvalue().splitlines(),
            ['Processing layer 1/3', 'Processing layer 2/3'],
        )
        self.assertEqual(stderr.getvalue(), '')

    def test_xia_result_progress_does_not_activate_when_no_layer_is_active(self) -> None:
        reporter = progress_module._DelayedLayerProgressReporter(total_layers=1)
        reporter._started_at = 0.0
        reporter.begin_layer()
        reporter.finish_layer()
        stdout = io.StringIO()
        stderr = io.StringIO()

        with (
            contextlib.redirect_stdout(stdout),
            contextlib.redirect_stderr(stderr),
            mock.patch.object(progress_module, '_ATTRIBUTION_PROGRESS_INITIAL_DELAY_SECONDS', 30.0),
        ):
            self.assertFalse(reporter._emit_if_due(now=31.0))

        self.assertEqual(stdout.getvalue(), '')
        self.assertEqual(stderr.getvalue(), '')

    def test_raw_level_mapping_does_not_emit_progress(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            original_preprocess = base_module.preprocess_array

            def slow_preprocess(source):
                time.sleep(0.03)
                return original_preprocess(source)

            stdout = io.StringIO()
            stderr = io.StringIO()
            with (
                mock.patch.object(progress_module, '_ATTRIBUTION_PROGRESS_INITIAL_DELAY_SECONDS', 0.01),
                mock.patch.object(base_module, 'preprocess_array', side_effect=slow_preprocess),
                contextlib.redirect_stdout(stdout),
                contextlib.redirect_stderr(stderr),
            ):
                GeoXplain(out_path=str(out_path)).add_attribution(
                    {'z-2': _array(1), 'z-3': _array(2)},
                    method='Saliency',
                )

            self.assertEqual(stdout.getvalue(), '')
            self.assertEqual(stderr.getvalue(), '')

    def test_multiple_input_variables_become_separate_methods(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            result = _result(
                'saliency',
                '2020-01-01T22:00:00Z',
                {
                    'zwd': {'z-2': _array(1)},
                    'q': {'sfc': _array(2)},
                },
            )

            GeoXplain(out_path=str(out_path), result=result)

            data = _read_json(out_path)
            labels = {method['label'] for method in data['methods'].values()}
            self.assertEqual(labels, {'saliency (zwd)', 'saliency (q)'})

    def test_unsupported_levels_are_warned_and_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))
            result = _result(
                'saliency',
                '2020-01-01T22:00:00Z',
                {'zwd': {'z-2': _array(1), 'pl-925': _array(2)}},
            )

            with self.assertWarnsRegex(UserWarning, r'GeoXplain: dropped 1 layer'):
                viewer.add_attribution(result)

            data = _read_json(out_path)
            method = next(iter(data['methods'].values()))
            levels = method['frames'][0]['levels']
            self.assertIn('z-2', levels)
            self.assertNotIn('pl-925', levels)

    def test_target_from_result_is_exported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            result = _result(
                'saliency',
                '2020-01-01T22:00:00Z',
                {'zwd': {'z-2': _array()}},
                target={'south': 45.8, 'west': 7.6, 'north': 46.8, 'east': 9.2},
            )

            GeoXplain(out_path=str(out_path), result=result)

            data = _read_json(out_path)
            method = next(iter(data['methods'].values()))
            target = method['frames'][0]['target']
            self.assertEqual(target['type'], 'box')
            self.assertEqual(target['latMin'], 45.8)
            self.assertEqual(target['latMax'], 46.8)

    def test_add_overlay_exports_overlay_result(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))
            overlay = SyntheticOverlay(frames=[
                SyntheticOverlayFrame('2020-01-01T00:00:00Z', _array(1)),
                SyntheticOverlayFrame('2020-01-01T06:00:00Z', _array(2)),
            ])

            viewer.add_overlay(overlay)

            data = _read_json(out_path)
            overlay_data = data['overlays']['specific-humidity-850-hpa']
            self.assertEqual(overlay_data['label'], 'Specific Humidity 850 hPa')
            self.assertEqual(overlay_data['unit'], 'kg/kg')
            self.assertFalse(overlay_data['visible'])
            self.assertEqual(
                [frame['timestamp'] for frame in overlay_data['frames']],
                ['2020-01-01T00:00:00Z', '2020-01-01T06:00:00Z'],
            )

    def test_add_overlay_exports_custom_colormap_stops(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))

            viewer.add_overlay(
                _array(1),
                name='Custom Overlay',
                colormap=[(0.0, '#2166ac'), (0.5, '#f7f7f7'), (1.0, '#b2182b')],
            )

            data = _read_json(out_path)
            overlay_data = data['overlays']['custom-overlay']
            self.assertEqual(overlay_data['colormap'], 'custom')
            self.assertEqual(
                overlay_data['colormapStops'],
                [[0.0, '#2166ac'], [0.5, '#f7f7f7'], [1.0, '#b2182b']],
            )

    def test_invalid_overlay_colormap_specs_raise(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))

            invalid_specs = [
                'not-a-preset',
                [(0.2, '#000000'), (1.0, '#ffffff')],
                [(0.0, '#000000'), (0.9, '#ffffff')],
                [(0.0, '#000000'), (0.0, '#ffffff'), (1.0, '#ff0000')],
                [(0.0, 'red'), (1.0, '#ffffff')],
                [(0.0, '#000000')],
            ]
            for spec in invalid_specs:
                with self.subTest(spec=spec):
                    with self.assertRaises(ValueError):
                        viewer.add_overlay(_array(1), name='Bad Overlay', colormap=spec)

    def test_add_overlay_preserves_custom_colormap(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / 'viewer_data.json'
            viewer = GeoXplain(out_path=str(out_path))
            overlay = SyntheticOverlay(
                label='Temperature Anomaly',
                colormap=[(0.0, '#2166ac'), (0.5, '#f7f7f7'), (1.0, '#b2182b')],
                frames=[SyntheticOverlayFrame('2020-01-01T00:00:00Z', _array(1))],
            )

            viewer.add_overlay(overlay)

            data = _read_json(out_path)
            overlay_data = data['overlays']['temperature-anomaly']
            self.assertEqual(overlay_data['colormap'], 'custom')
            self.assertEqual(
                overlay_data['colormapStops'],
                [[0.0, '#2166ac'], [0.5, '#f7f7f7'], [1.0, '#b2182b']],
            )


if __name__ == '__main__':
    unittest.main()
