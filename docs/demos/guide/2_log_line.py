import math
import nebo as nb

for step in range(100):
    loss = math.exp(-step / 30) + 0.05 * math.sin(step / 5)
    accuracy = min(1.0, 0.5 + step * 0.005)
    nb.log_line("loss", loss)
    nb.log_line("accuracy", accuracy)
