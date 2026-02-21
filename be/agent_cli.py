#!/usr/bin/env python3
"""CLI for the minimal Backboard agent."""

import argparse
import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

from agent import WBAgent

load_dotenv(Path(__file__).parent / ".env")


async def run_agent(prompt: str, assistant_name: str = "CLI Agent") -> str:
    async with WBAgent() as agent:
        await agent.create_assistant(name=assistant_name)
        await agent.create_thread()

        result = await agent.send_message(prompt)

        if result.tool_events:
            lines = result.tool_events.copy()

            return "\n".join(lines)

        return "[NO_TOOL_CALLS]"


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the UP agent with a prompt")
    parser.add_argument("prompt", help="Prompt to send")
    parser.add_argument("--name", default="CLI Agent", help="Assistant name")
    args = parser.parse_args()

    try:
        print(asyncio.run(run_agent(args.prompt, args.name)))
    except KeyboardInterrupt:
        print("\nInterrupted", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
