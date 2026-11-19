import re
import unicodedata

# Strip common edition/remaster/live/deluxe suffixes for grouping
_EDITION_PATTERNS = [
    r"\s*[\(\[]\s*(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|deluxe(?:\s+edition)?|expanded(?:\s+edition)?|special\s+edition|anniversary\s+edition|bonus\s+track(?:s)?(?:\s+version)?|super\s+deluxe|explicit|clean|radio\s+edit|album\s+version|single\s+version|original\s+mix|mono|stereo)\s*[\)\]]",
    r"\s*-\s*(?:single|ep|remastered(?:\s+\d{4})?|deluxe(?:\s+edition)?)$",
]
_EDITION_RE = [re.compile(p, re.IGNORECASE) for p in _EDITION_PATTERNS]

# Strip featuring credits from track titles or artists for primary grouping
_FEAT_RE = re.compile(
    r"\s*[\(\[]?\s*(?:feat\.?|ft\.?|featuring|with)\s+[^\)\]]+[\)\]]?",
    re.IGNORECASE,
)

_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
_SPACE_RE = re.compile(r"\s+")


def normalize_basic(text: str | None) -> str:
    if not text:
        return ""
    s = unicodedata.normalize("NFKC", text).strip().lower()
    # Normalize curly quotes / dashes
    s = s.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u2013", "-").replace("\u2014", "-")
    s = _SPACE_RE.sub(" ", s)
    return s


def strip_accents(text: str) -> str:
    nfd = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")


def clean_group_key(text: str | None, strip_feat: bool = False) -> str:
    s = normalize_basic(text)
    if not s:
        return ""
    for rx in _EDITION_RE:
        s = rx.sub("", s)
    if strip_feat:
        s = _FEAT_RE.sub("", s)
    s = strip_accents(s)
    s = _PUNCT_RE.sub(" ", s)
    s = _SPACE_RE.sub(" ", s).strip()
    return s


def clean_display_title(text: str | None) -> str:
    if not text:
        return ""
    return unicodedata.normalize("NFKC", text).strip()


def primary_artist_name(artist: str | None) -> str:
    """Return a clean display primary artist while preserving band names with '&'."""
    if not artist:
        return ""
    s = unicodedata.normalize("NFKC", artist).strip()
    # Strip explicit feat./ft. suffix
    s = _FEAT_RE.sub("", s).strip()
    return s


def make_track_key(song_name: str, album_name: str) -> str:
    return f"{normalize_basic(song_name)}||{normalize_basic(album_name)}"


def similarity_score(a: str, b: str) -> float:
    """Fast token + substring similarity in [0, 1] for matching iTunes/Deezer results."""
    ka = clean_group_key(a, strip_feat=True)
    kb = clean_group_key(b, strip_feat=True)
    if not ka or not kb:
        return 0.0
    if ka == kb:
        return 1.0
    if ka in kb or kb in ka:
        return 0.88
    ta = set(ka.split())
    tb = set(kb.split())
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta | tb)
    return inter / union
