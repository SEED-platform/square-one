# Python Notebooks

This directory contains python notebooks for non-critical tasks for this project. They may be useful for people developing this project but not necessarily for Square One users.

The same poetry environment that is used in square-one is used to run these notebooks. If new dependencies are needed, make sure to add them as development dependencies so they are not deployed with the application in production mode.

e.g.,

```bash
  poetry add osmnx --group dev
```
