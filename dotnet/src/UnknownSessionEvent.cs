/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

using System.Text.Json.Serialization;

namespace GitHub.Copilot.SDK;

/// <summary>
/// Represents a session event whose <c>type</c> discriminator is not recognized by this
/// version of the SDK.
/// </summary>
/// <remarks>
/// <para>
/// When the Copilot CLI emits an event type that the SDK has not yet been updated to
/// support, deserialization via <see cref="SessionEvent.FromJson"/> would normally throw
/// a <see cref="System.Text.Json.JsonException"/>. Instead,
/// <see cref="SessionEvent.TryFromJson"/> catches the failure and returns an
/// <see cref="UnknownSessionEvent"/> that preserves the raw JSON for diagnostic purposes.
/// </para>
/// <para>
/// Consumers can pattern-match on this type to detect and log forward-compatibility gaps
/// without losing the rest of the event stream.
/// </para>
/// </remarks>
public sealed class UnknownSessionEvent : SessionEvent
{
    /// <inheritdoc />
    [JsonIgnore]
    public override string Type => RawType ?? "unknown";

    /// <summary>
    /// The original <c>type</c> discriminator value from the JSON payload, if it could be
    /// extracted. <c>null</c> when the type field is missing or unreadable.
    /// </summary>
    public string? RawType { get; init; }

    /// <summary>
    /// The complete, unparsed JSON string of the event. Useful for logging, debugging,
    /// or forwarding to systems that may understand the event.
    /// </summary>
    public string? RawJson { get; init; }
}
