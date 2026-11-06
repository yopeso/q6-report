"""Recorders for q6-report. Standard library only, because a suite may run under a Python it cannot install into."""

from .kit import attach, attach_image

__all__ = ["attach", "attach_image"]
