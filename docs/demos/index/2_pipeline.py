import nebo as nb

@nb.fn()
def load_data():
    records = [{"id": i, "value": i * 0.5} for i in range(100)]
    nb.log(f"Loaded {len(records)} records")
    return records

@nb.fn()
def process(records):
    for r in nb.track(records, name="processing"):
        r["value"] *= 2
    nb.log_line("count", float(len(records)))
    return records

def run():
    data = load_data()
    return process(data)

if __name__ == "__main__":
    run()
