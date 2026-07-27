"""Unit tests for canonicalization helpers ported from sync-catalog.mjs."""

from scraper.normalize import (
    brand_name,
    bucket_bridge,
    bucket_eye,
    bucket_temple,
    handles_to_unpublish,
)


class TestBrandName:
    def test_known_slug_maps_to_display_name(self) -> None:
        assert brand_name("di-caprio") == "Di Caprio"
        assert brand_name("4u") == "Four You"
        assert brand_name("case") == "Cases"

    def test_unknown_slug_is_title_cased(self) -> None:
        assert brand_name("new-brand") == "New Brand"

    def test_single_word_unknown_slug(self) -> None:
        assert brand_name("acme") == "Acme"


class TestMeasurementBuckets:
    def test_eye_buckets_boundaries(self) -> None:
        assert bucket_eye(43) == "34-43 mm"
        assert bucket_eye(44) == "44-47 mm"
        assert bucket_eye(54) == "54-56 mm"
        assert bucket_eye(60) == "Más de 60 mm"

    def test_bridge_buckets_boundaries(self) -> None:
        assert bucket_bridge(15) == "13-15 mm"
        assert bucket_bridge(18) == "18-19 mm"
        assert bucket_bridge(24) == "23-24 mm"

    def test_temple_buckets_boundaries(self) -> None:
        assert bucket_temple(120) == "115-120 mm"
        assert bucket_temple(145) == "145-150 mm"
        assert bucket_temple(999) == "155+ mm"

    def test_none_returns_none(self) -> None:
        assert bucket_eye(None) is None
        assert bucket_bridge(None) is None
        assert bucket_temple(None) is None


class TestHandlesToUnpublish:
    def test_returns_published_not_seen(self) -> None:
        published = {"a-di-caprio", "b-di-caprio", "c-di-caprio"}
        seen = {"a-di-caprio", "c-di-caprio"}
        assert handles_to_unpublish(published, seen) == {"b-di-caprio"}

    def test_nothing_stale_when_all_seen(self) -> None:
        published = {"a-4u", "b-4u"}
        assert handles_to_unpublish(published, {"a-4u", "b-4u", "extra-4u"}) == set()

    def test_empty_published(self) -> None:
        assert handles_to_unpublish(set(), {"a-4u"}) == set()
