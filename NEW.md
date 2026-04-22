## Global logging (outside of decorated functions)

* Add new loggable class, LoggableInfo in state.py
* NodeInfo class can inherit from LoggableInfo
* LoggableInfo contains
    * logs: list = field(default_factory=list)
    * metrics: dict = field(default_factory=lambda: {})  # name -> [(step, value)]
    * errors: list = field(default_factory=list)
    * images: list = field(default_factory=list)
    * audio: list = field(default_factory=list)
    * progress: Optional[dict] = None
* Initialize every run with a fixed loggable instance named global.
* nb.log will log under global if not directly inside a decorated function
* global is outside of any dag, doesn't have any function associated with it
* *.log functions will reference loggable_id (rather than node_id)
* UI:
    * Does not show up in DAG view
    * nb.log() is grouped together, nb.log_* are separated by name parameter

## Settings pane

For now, this allows us to just adjust image labels inside of image logs across all node view images and the set of global view images.
See section below on image labels

We can adjust:
* label opacity 
* label

Each label is identified in the UI by: [Loggable Name] > [image name] > [label key]


## Image Labels

Add parameter for named labels 
nb.log_image(image: Any, *, ..., labels: dict)

* points
* boxes
* circles
* Masks polygon, bitmask
* Or follow standards

Ex: nb.log_image(im, labels={"points": [torch.tensor([[45,80], [55,60]])]})

In UI: allow named labels to be toggle-able in settings pane

## New metrics

* bar chart
* scatter plot
* pie chart
* histogram

nb.log_metric(name: str, type="bar", tags=[], value: Union[int | float | tensor | ndarray | dict]...)

dict will contain either int, float, tensor or ndarray
tags is only used if value is dict
tags allows the UI to toggle visibility of sets of values


## Docs:
* Update API reference
* Update message about nebo being for function-level logging.
* It's "A modern logging SDK for multi-modal data"




