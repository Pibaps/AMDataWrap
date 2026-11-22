"""AMDataWrap V3 Musicological Data-Science facade (re-exports split submodules for 100% compatibility)."""

from .atlas_geo import get_world_atlas
from .camelot_playlists import (
    ALL_CAMELOT_CODES,
    CAMELOT_TO_KEY,
    KEY_TO_CAMELOT,
    _deterministic_prior_audio_dna,
    build_smart_playlist,
    camelot_compatible_codes,
    format_playlist_export,
    get_camelot_wheel,
    get_emotional_compass,
    to_camelot,
    upsert_track_audio_dna,
)
from .eras_pelt import get_musical_eras_pelt
from .iceberg_games import (
    ICEBERG_TIERS,
    _hsl_hex_for_key,
    fts5_search,
    get_blind_test_quiz,
    get_collector_atelier,
    get_music_iceberg,
)
from .science_metrics import (
    compute_eddington_number,
    compute_gini_and_effective_core,
    compute_shannon_entropy,
    get_cooccurrence_graph_2d,
    get_science_metrics,
)

__all__ = [
    "ALL_CAMELOT_CODES",
    "CAMELOT_TO_KEY",
    "ICEBERG_TIERS",
    "KEY_TO_CAMELOT",
    "_deterministic_prior_audio_dna",
    "_hsl_hex_for_key",
    "build_smart_playlist",
    "camelot_compatible_codes",
    "compute_eddington_number",
    "compute_gini_and_effective_core",
    "compute_shannon_entropy",
    "format_playlist_export",
    "fts5_search",
    "get_blind_test_quiz",
    "get_camelot_wheel",
    "get_collector_atelier",
    "get_cooccurrence_graph_2d",
    "get_emotional_compass",
    "get_music_iceberg",
    "get_musical_eras_pelt",
    "get_science_metrics",
    "get_world_atlas",
    "to_camelot",
    "upsert_track_audio_dna",
]
