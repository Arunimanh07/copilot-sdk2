/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;

namespace GitHub.Copilot.SDK;

public abstract partial class SessionEvent
{
    /// <summary>
    /// Attempts to deserialize a JSON string into a <see cref="SessionEvent"/>.
    /// </summary>
    /// <param name="json">The JSON string representing a session event.</param>
    /// <param name="logger">Optional logger for recording deserialization warnings.</param>
    /// <returns>
    /// The deserialized <see cref="SessionEvent"/> on success, or an
    /// <see cref="UnknownSessionEvent"/> when the event type is not recognized by this
    /// version of the SDK.
    /// </returns>
    /// <remarks>
    /// Unlike <see cref="FromJson"/>, this method never throws for unknown event types.
    /// It catches <see cref="JsonException"/> and returns an <see cref="UnknownSessionEvent"/>
    /// that preserves the raw JSON and type discriminator for diagnostic purposes.
    /// </remarks>
    public static SessionEvent TryFromJson(string json, ILogger? logger = null)
    {
        try
        {
            return FromJson(json);
        }
        catch (JsonException ex)
        {
            var rawType = ExtractTypeDiscriminator(json);
            logger?.LogWarning(ex, "Skipping unrecognized session event type '{EventType}'", rawType);

            return new UnknownSessionEvent
            {
                RawType = rawType,
                RawJson = json,
            };
        }
    }

    private static string? ExtractTypeDiscriminator(string json)
    {
        try
        {
            var node = JsonNode.Parse(json);
            return node?["type"]?.GetValue<string>();
        }
        catch
        {
            return null;
        }
    }
}
