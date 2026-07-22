"""Unit tests for deterministic filler-data generation (rating/reviews/best-seller/compare-at price)."""

from scraper.filler import generate_filler


class TestGenerateFiller:
    def test_deterministic_for_same_handle(self) -> None:
        a = generate_filler("dc101-black-di-caprio", 9900)
        b = generate_filler("dc101-black-di-caprio", 9900)
        assert a == b

    def test_bounds(self) -> None:
        for handle in ("frame-a", "frame-b", "frame-c", "another-handle-entirely"):
            filler = generate_filler(handle, 9900)
            assert 3.5 <= filler.rating <= 5.0
            assert 8 <= filler.review_count <= 247
            assert isinstance(filler.best_seller, bool)
            if filler.original_price_cents is not None:
                assert filler.original_price_cents > 9900

    def test_distinct_handles_diverge(self) -> None:
        results = [generate_filler(f"handle-{i}", 9900) for i in range(20)]
        # Not every field needs to differ, but ratings across 20 distinct handles
        # should not all collapse to the same value.
        ratings = {r.rating for r in results}
        assert len(ratings) > 1

    def test_original_price_never_below_price(self) -> None:
        for handle in ("a", "b", "c", "d", "e", "f"):
            filler = generate_filler(handle, 5000)
            if filler.original_price_cents is not None:
                assert filler.original_price_cents >= 5000
