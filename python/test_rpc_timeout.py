"""Tests for timeout parameter on generated RPC methods."""
from unittest.mock import AsyncMock

import pytest

from copilot.generated.rpc import (
    FleetApi,
    Mode,
    ModeApi,
    SessionFleetStartParams,
    SessionModeSetParams,
)


class TestRpcTimeout:
    @pytest.mark.asyncio
    async def test_default_timeout_not_forwarded(self):
        client = AsyncMock()
        client.request = AsyncMock(return_value={"started": True})
        api = FleetApi(client, "sess-1")

        await api.start(SessionFleetStartParams(prompt="go"))

        client.request.assert_called_once()
        _, kwargs = client.request.call_args
        assert "timeout" not in kwargs

    @pytest.mark.asyncio
    async def test_custom_timeout_forwarded(self):
        client = AsyncMock()
        client.request = AsyncMock(return_value={"started": True})
        api = FleetApi(client, "sess-1")

        await api.start(SessionFleetStartParams(prompt="go"), timeout=600.0)

        _, kwargs = client.request.call_args
        assert kwargs["timeout"] == 600.0

    @pytest.mark.asyncio
    async def test_timeout_on_other_methods(self):
        client = AsyncMock()
        client.request = AsyncMock(return_value={"mode": "plan"})
        api = ModeApi(client, "sess-1")

        await api.set(SessionModeSetParams(mode=Mode.PLAN), timeout=120.0)

        _, kwargs = client.request.call_args
        assert kwargs["timeout"] == 120.0
