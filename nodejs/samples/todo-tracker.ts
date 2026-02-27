/**
 * TodoTracker — using the Copilot SDK's query() convenience API.
 *
 * Run:  COPILOT_CLI_URL=localhost:PORT npx tsx todo-tracker.ts
 *       (start the CLI first with: copilot --headless)
 */

import { z } from "zod";
import { query, defineTool } from "@github/copilot-sdk";

class TodoTracker {
    private todos: any[] = [];

    displayProgress() {
        if (this.todos.length === 0) return;
        const completed = this.todos.filter((t) => t.status === "completed").length;
        const inProgress = this.todos.filter((t) => t.status === "in_progress").length;
        const total = this.todos.length;
        console.log(`\nProgress: ${completed}/${total} completed`);
        console.log(`Currently working on: ${inProgress} task(s)\n`);
        this.todos.forEach((todo, index) => {
            const icon =
                todo.status === "completed" ? "✅" : todo.status === "in_progress" ? "🔧" : "❌";
            const text = todo.status === "in_progress" ? todo.activeForm : todo.content;
            console.log(`${index + 1}. ${icon} ${text}`);
        });
    }

    todoWriteTool = defineTool("TodoWrite", {
        description: "Write or update the todo list for the current task.",
        parameters: z.object({
            todos: z.array(
                z.object({
                    content: z.string(),
                    status: z.enum(["completed", "in_progress", "pending"]),
                    activeForm: z.string().optional(),
                }),
            ),
        }),
        handler: ({ todos }) => {
            this.todos = todos;
            this.displayProgress();
            return "Todo list updated.";
        },
    });

    async trackQuery(prompt: string) {
        for await (const event of query({ prompt, tools: [this.todoWriteTool], maxTurns: 20 })) {
            if (event.type === "assistant.message_delta") {
                process.stdout.write(event.data.deltaContent);
            }
        }
    }
}

// Usage
const tracker = new TodoTracker();
await tracker.trackQuery("Build a complete authentication system with todos");
