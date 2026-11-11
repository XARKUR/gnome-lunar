PYTHON ?= python3
.DEFAULT_GOAL := plan
.PHONY: plan check package
plan:
	$(PYTHON) project.py plan
check:
	$(PYTHON) project.py check
package:
	$(PYTHON) project.py package
