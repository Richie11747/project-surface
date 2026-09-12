# pricing-svc

A deliberately small Go service used as a project-surface fixture. It exists to
exercise the honest-degradation path: on a machine without the Go toolchain the
adapter still reads structure from source, but marks the stack unavailable and
refuses to report any test as passing.
