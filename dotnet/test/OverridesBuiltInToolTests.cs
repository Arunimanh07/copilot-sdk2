/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

using Microsoft.Extensions.AI;
using System.Collections.ObjectModel;
using System.ComponentModel;
using Xunit;

namespace GitHub.Copilot.SDK.Test;

public class OverridesBuiltInToolTests
{
    [Fact]
    public void ToolDefinition_FromAIFunction_Sets_OverridesBuiltInTool()
    {
        var fn = AIFunctionFactory.Create((Delegate)Noop, new AIFunctionFactoryOptions
        {
            Name = "grep",
            AdditionalProperties = new ReadOnlyDictionary<string, object?>(
                new Dictionary<string, object?> { ["is_override"] = true })
        });
        var def = CopilotClient.ToolDefinition.FromAIFunction(fn);

        Assert.Equal("grep", def.Name);
        Assert.True(def.OverridesBuiltInTool);
    }

    [Fact]
    public void ToolDefinition_FromAIFunction_Omits_OverridesBuiltInTool_When_False()
    {
        var fn = AIFunctionFactory.Create(Noop, "custom_tool");
        var def = CopilotClient.ToolDefinition.FromAIFunction(fn);

        Assert.Equal("custom_tool", def.Name);
        Assert.Null(def.OverridesBuiltInTool);
    }

    [Description("No-op")]
    static string Noop() => "";
}
