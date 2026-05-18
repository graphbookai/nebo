import numpy as np
import nebo as nb

nb.log("Starting training...")
for epoch in range(3):
    loss = 1.0 / (epoch + 1)
    nb.log(f"Epoch {epoch}: loss={loss:.4f}")

nb.log(np.random.default_rng(0).standard_normal((32, 64)))
