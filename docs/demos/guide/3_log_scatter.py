import random
import nebo as nb

random.seed(0)
centers = {"A": (0.0, 0.0), "B": (5.0, 5.0), "C": (-5.0, 3.0)}
for _ in range(10):
    batch = {
        label: [
            (cx + random.gauss(0, 0.5), cy + random.gauss(0, 0.5))
            for _ in range(8)
        ]
        for label, (cx, cy) in centers.items()
    }
    nb.log_scatter("embed_2d", batch)
