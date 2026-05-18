import nebo as nb

nb.init(dag_strategy="stack")


@nb.fn()
def load():
    return [1, 2, 3]


@nb.fn()
def transform(data):
    return [x * 2 for x in data]


@nb.fn()
def run():
    data = load()
    return transform(data)


run()
