"""Multi-Run Hyperparameter Sweep

Demonstrates:
- nb.start_run() for creating separate runs within one script
- Run-level config via the config= parameter
- Run naming for easy identification in the UI
- The interleave/resume pattern for alternating between runs
"""

import numpy as np
import nebo as nb


@nb.fn()
def generate_data(n: int = 200):
    """Generate synthetic training data."""
    np.random.seed(42)
    X = np.random.randn(n, 5).astype(np.float32)
    y = (X[:, 0] * 0.5 + X[:, 1] * 0.3 + np.random.randn(n) * 0.1).astype(np.float32)
    nb.log(f"Generated {n} samples with 5 features")
    return X, y


@nb.fn()
def train(X, y, lr: float = 0.01, epochs: int = 50):
    """Train a simple linear model with gradient descent."""
    nb.log_cfg({"lr": lr, "epochs": epochs})
    w = np.zeros(X.shape[1], dtype=np.float32)

    for epoch in nb.track(range(epochs), name="training"):
        preds = X @ w
        error = preds - y
        loss = float(np.mean(error ** 2))
        w -= lr * (2 / len(y)) * (X.T @ error)
        nb.log_metric("loss", loss, step=epoch)

        if epoch % 10 == 0:
            nb.log(f"Epoch {epoch}: loss={loss:.4f}")

    final_loss = float(np.mean((X @ w - y) ** 2))
    nb.log(f"Final loss: {final_loss:.4f}")
    return w, final_loss


@nb.fn()
def evaluate(X, y, w):
    """Evaluate the trained model."""
    preds = X @ w
    mse = float(np.mean((preds - y) ** 2))
    r2 = 1 - mse / float(np.var(y))
    nb.log_metric("mse", mse)
    nb.log_metric("r2", r2)
    nb.log(f"MSE={mse:.4f}, R2={r2:.4f}")
    return {"mse": mse, "r2": r2}


def run_experiment(lr: float, epochs: int):
    """Run a single experiment end-to-end."""
    X, y = generate_data()
    w, _ = train(X, y, lr=lr, epochs=epochs)
    return evaluate(X, y, w)


def main():
    # -------------------------------------------------------------------------
    # Pattern 1: Sequential runs — hyperparameter sweep
    # Each config gets its own run with a descriptive name.
    # -------------------------------------------------------------------------
    configs = [
        {"lr": 0.001, "epochs": 100},
        {"lr": 0.01, "epochs": 100},
        {"lr": 0.1, "epochs": 100},
        {"lr": 0.01, "epochs": 200},
    ]

    results = []
    for cfg in configs:
        with nb.start_run(name=f"lr={cfg['lr']}, ep={cfg['epochs']}", config=cfg):
            nb.md(f"# Sweep: lr={cfg['lr']}, epochs={cfg['epochs']}")
            metrics = run_experiment(lr=cfg["lr"], epochs=cfg["epochs"])
            results.append((cfg, metrics))

    print("\n--- Sweep Results ---")
    for cfg, metrics in results:
        print(f"  lr={cfg['lr']}, epochs={cfg['epochs']} => "
              f"MSE={metrics['mse']:.4f}, R2={metrics['r2']:.4f}")

    # -------------------------------------------------------------------------
    # Pattern 2: Interleaved runs — alternating train/eval
    # Two persistent runs that accumulate data across iterations.
    # -------------------------------------------------------------------------
    train_id = eval_id = None

    for iteration in range(3):
        with nb.start_run(name="training-monitor", run_id=train_id) as run:
            train_id = run.run_id
            nb.log(f"Training iteration {iteration}")
            nb.log_metric("iteration", float(iteration))
            nb.log_metric("train_loss", float(np.random.exponential(0.5)))

        with nb.start_run(name="eval-monitor", run_id=eval_id) as run:
            eval_id = run.run_id
            nb.log(f"Eval iteration {iteration}")
            nb.log_metric("iteration", float(iteration))
            nb.log_metric("eval_acc", float(0.7 + 0.1 * iteration))

    print("\n--- Interleaved Runs ---")
    print(f"  Training run: {train_id}")
    print(f"  Eval run:     {eval_id}")


if __name__ == "__main__":
    main()
