/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

using Xunit;

namespace GitHub.Copilot.SDK.Test;

/// <summary>
/// Tests for forward-compatible handling of unknown session event types.
/// Verifies that the SDK gracefully handles event types introduced by newer CLI versions.
/// </summary>
public class UnknownSessionEventTests
{
    [Fact]
    public void FromJson_KnownEventType_DeserializesNormally()
    {
        var json = """
        {
            "id": "00000000-0000-0000-0000-000000000001",
            "timestamp": "2026-01-01T00:00:00Z",
            "parentId": null,
            "type": "user.message",
            "data": {
                "content": "Hello"
            }
        }
        """;

        var result = SessionEvent.FromJson(json);

        Assert.IsType<UserMessageEvent>(result);
        Assert.Equal("user.message", result.Type);
    }

    [Fact]
    public void FromJson_UnknownEventType_Throws()
    {
        var json = """
        {
            "id": "00000000-0000-0000-0000-000000000007",
            "timestamp": "2026-01-01T00:00:00Z",
            "parentId": null,
            "type": "future.feature_from_server",
            "data": {}
        }
        """;

        Assert.Throws<System.Text.Json.JsonException>(() => SessionEvent.FromJson(json));
    }

    [Fact]
    public void UnknownSessionEvent_Type_ReturnsRawType()
    {
        var evt = new UnknownSessionEvent
        {
            RawType = "future.feature",
            RawJson = """{"type":"future.feature"}""",
        };

        Assert.Equal("future.feature", evt.Type);
        Assert.Equal("future.feature", evt.RawType);
        Assert.NotNull(evt.RawJson);
    }

    [Fact]
    public void UnknownSessionEvent_Type_FallsBackToUnknown_WhenRawTypeIsNull()
    {
        var evt = new UnknownSessionEvent { RawType = null, RawJson = null };

        Assert.Equal("unknown", evt.Type);
    }

    [Fact]
    public void UnknownSessionEvent_PreservesRawJson()
    {
        var rawJson = """{"type":"new.event","data":{"nested":{"deep":true},"list":[1,2,3]}}""";
        var evt = new UnknownSessionEvent
        {
            RawType = "new.event",
            RawJson = rawJson,
        };

        Assert.Equal(rawJson, evt.RawJson);
        Assert.Contains("nested", evt.RawJson);
    }

    [Fact]
    public void UnknownSessionEvent_IsSessionEvent()
    {
        var evt = new UnknownSessionEvent { RawType = "future.event" };

        Assert.IsAssignableFrom<SessionEvent>(evt);
    }

    [Fact]
    public void TryFromJson_KnownEventType_DeserializesNormally()
    {
        var json = """
        {
            "id": "00000000-0000-0000-0000-000000000010",
            "timestamp": "2026-01-01T00:00:00Z",
            "parentId": null,
            "type": "user.message",
            "data": {
                "content": "Hello"
            }
        }
        """;

        var result = SessionEvent.TryFromJson(json);

        Assert.IsType<UserMessageEvent>(result);
        Assert.Equal("user.message", result.Type);
    }

    [Fact]
    public void TryFromJson_UnknownEventType_ReturnsUnknownSessionEvent()
    {
        var json = """
        {
            "id": "00000000-0000-0000-0000-000000000011",
            "timestamp": "2026-01-01T00:00:00Z",
            "parentId": null,
            "type": "future.feature_from_server",
            "data": { "key": "value" }
        }
        """;

        var result = SessionEvent.TryFromJson(json);

        var unknown = Assert.IsType<UnknownSessionEvent>(result);
        Assert.Equal("future.feature_from_server", unknown.RawType);
        Assert.Equal("future.feature_from_server", unknown.Type);
        Assert.NotNull(unknown.RawJson);
        Assert.Contains("future.feature_from_server", unknown.RawJson);
    }

    [Fact]
    public void TryFromJson_UnknownEventType_PreservesRawJson()
    {
        var json = """
        {
            "id": "00000000-0000-0000-0000-000000000012",
            "timestamp": "2026-01-01T00:00:00Z",
            "parentId": null,
            "type": "some.new.event",
            "data": { "nested": { "deep": true }, "list": [1, 2, 3] }
        }
        """;

        var result = SessionEvent.TryFromJson(json);

        var unknown = Assert.IsType<UnknownSessionEvent>(result);
        Assert.Contains("\"nested\"", unknown.RawJson);
        Assert.Contains("\"deep\"", unknown.RawJson);
    }

    [Fact]
    public void TryFromJson_MultipleEvents_MixedKnownAndUnknown()
    {
        var events = new[]
        {
            """{"id":"00000000-0000-0000-0000-000000000013","timestamp":"2026-01-01T00:00:00Z","parentId":null,"type":"user.message","data":{"content":"Hi"}}""",
            """{"id":"00000000-0000-0000-0000-000000000014","timestamp":"2026-01-01T00:00:00Z","parentId":null,"type":"future.unknown_type","data":{}}""",
            """{"id":"00000000-0000-0000-0000-000000000015","timestamp":"2026-01-01T00:00:00Z","parentId":null,"type":"user.message","data":{"content":"Bye"}}""",
        };

        var results = events.Select(e => SessionEvent.TryFromJson(e)).ToList();

        Assert.Equal(3, results.Count);
        Assert.IsType<UserMessageEvent>(results[0]);
        Assert.IsType<UnknownSessionEvent>(results[1]);
        Assert.IsType<UserMessageEvent>(results[2]);
    }
}
