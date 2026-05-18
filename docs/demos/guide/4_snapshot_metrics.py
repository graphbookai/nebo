import random
import nebo as nb

random.seed(0)

nb.log_bar("class_counts", {"cat": 42, "dog": 38, "bird": 17, "fish": 23})

nb.log_pie("splits", {"train": 800, "val": 100, "test": 100})

scores_a = [random.gauss(0.7, 0.1) for _ in range(500)]
scores_b = [random.gauss(0.5, 0.15) for _ in range(500)]
nb.log_histogram("score_dist", {"model_a": scores_a, "model_b": scores_b})
