"""Unit tests for AI-assisted translation — all Anthropic calls are mocked, no live API use."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from scraper.config import Config
from scraper.translate import translate_product


def _config_with_key(key: str = "sk-ant-test") -> Config:
    return Config(anthropic_api_key=key)


def _fake_message(text: str) -> SimpleNamespace:
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)])


class TestTranslateProduct:
    def test_missing_api_key_returns_none(self) -> None:
        result = translate_product("DC101", "A classic frame.", _config_with_key(""))
        assert result is None

    def test_successful_translation(self) -> None:
        canned = _fake_message(
            '{"es": {"title": "DC101", "description": "Un armazón clásico."}, '
            '"fr": {"title": "DC101", "description": "Une monture classique."}}'
        )
        with patch("anthropic.Anthropic") as MockAnthropic:
            MockAnthropic.return_value.messages.create.return_value = canned
            result = translate_product("DC101", "A classic frame.", _config_with_key())

        assert result is not None
        assert result["es"]["title"] == "DC101"
        assert result["es"]["description"] == "Un armazón clásico."
        assert result["fr"]["description"] == "Une monture classique."

    def test_malformed_json_returns_none(self) -> None:
        canned = _fake_message("not valid json")
        with patch("anthropic.Anthropic") as MockAnthropic:
            MockAnthropic.return_value.messages.create.return_value = canned
            result = translate_product("DC101", "A classic frame.", _config_with_key())

        assert result is None

    def test_api_exception_returns_none(self) -> None:
        with patch("anthropic.Anthropic") as MockAnthropic:
            MockAnthropic.return_value.messages.create.side_effect = RuntimeError("rate limited")
            result = translate_product("DC101", "A classic frame.", _config_with_key())

        assert result is None

    def test_partial_response_only_populates_valid_locales(self) -> None:
        canned = _fake_message('{"es": {"title": "DC101", "description": "..."}}')
        with patch("anthropic.Anthropic") as MockAnthropic:
            MockAnthropic.return_value.messages.create.return_value = canned
            result = translate_product("DC101", "A classic frame.", _config_with_key())

        assert result is not None
        assert "es" in result
        assert "fr" not in result
