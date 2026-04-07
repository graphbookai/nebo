"""Example 5: Interactive Pipeline with nb.ask()

Demonstrates:
- nb.ask() for pausing execution and prompting the user
- nb.ask() with constrained options
- nb.ask() with free-form text input
- Branching pipeline logic based on user responses
"""

import time
import nebo as nb


nb.md("An interactive pipeline that asks the user for input at key decision points.")


@nb.fn()
def collect_preferences() -> dict:
    """Gather user preferences to configure the pipeline."""
    name = nb.ask("What is your name?")
    nb.log(f"User: {name}")

    mode = nb.ask("Which processing mode?", options=["fast", "balanced", "thorough"])
    nb.log(f"Mode: {mode}")

    return {"name": name, "mode": mode}


@nb.fn()
def generate_data(mode: str) -> list[float]:
    """Generate data with size based on the chosen mode."""
    sizes = {"fast": 10, "balanced": 50, "thorough": 200}
    n = sizes.get(mode, 50)
    data = [i * 0.1 for i in range(n)]
    nb.log(f"Generated {n} data points in '{mode}' mode")
    time.sleep(0.3)
    return data


@nb.fn()
def process(data: list[float]) -> dict:
    """Process the data and compute summary statistics."""
    result = {
        "count": len(data),
        "sum": sum(data),
        "mean": sum(data) / len(data) if data else 0,
    }
    nb.log(f"Processed {result['count']} points: mean={result['mean']:.2f}")
    time.sleep(0.3)
    return result


@nb.fn()
def review_results(prefs: dict, result: dict) -> str:
    """Present results and ask the user whether to accept or retry."""
    nb.log(f"Results for {prefs['name']}: count={result['count']}, mean={result['mean']:.2f}")

    decision = nb.ask(
        f"Mean is {result['mean']:.2f}. Accept these results?",
        options=["yes", "no"],
    )
    nb.log(f"Decision: {decision}")
    return decision


@nb.fn()
def run_pipeline() -> dict:
    """Interactive pipeline: collect preferences, generate, process, review."""
    prefs = collect_preferences()
    data = generate_data(prefs["mode"])
    result = process(data)

    decision = review_results(prefs, result)
    if decision == "no":
        nb.log("User rejected results — re-running with thorough mode")
        data = generate_data("thorough")
        result = process(data)

    nb.log(f"Final result: {result}")
    return result


def main():
    result = run_pipeline()
    print(f"\nDone: {result}")


if __name__ == "__main__":
    main()
