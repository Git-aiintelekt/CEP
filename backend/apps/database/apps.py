from django.apps import AppConfig


class DatabaseConfig(AppConfig):
    name = "apps.database"
    label = "database"
    verbose_name = "CEP database schema (DDL migrations)"
