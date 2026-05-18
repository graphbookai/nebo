import math
import nebo as nb


@nb.fn()
def train(lr: float = 0.001, epochs: int = 50):
    nb.log_cfg({"lr": lr, "epochs": epochs, "optimizer": "adam"})
    for step in range(epochs):
        nb.log_line("loss", math.exp(-step / 20))


train()
