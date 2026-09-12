"""A minimal decorator-based router, so the fixture needs no web framework."""

ROUTES: list[tuple[str, str, object]] = []


class _Router:
    def post(self, path: str):
        def decorator(fn):
            ROUTES.append(("POST", path, fn))
            return fn

        return decorator

    def get(self, path: str):
        def decorator(fn):
            ROUTES.append(("GET", path, fn))
            return fn

        return decorator


app = _Router()
