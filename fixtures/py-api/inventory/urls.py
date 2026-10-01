"""Django-style URL patterns.

path / re_path are not imported: the adapter is a line scan, and pulling
Django into the fixture would be the same mistake as adding Rocket to rust-svc.
"""

urlpatterns = [
    path("inventory/quote", views.quote_list),
    re_path(r"^inventory/search/", views.search),
]
