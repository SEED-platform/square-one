"""
Logging utilities for the CBL Web Tool services.
"""

import logging
import traceback
from collections.abc import Callable
from functools import wraps
from typing import Any, Optional


def log_error_with_context(message: str, error: Exception, extra_context: Optional[dict] = None) -> None:
    """
    Log an error with additional context information.

    Args:
        message: Base error message
        error: The exception that occurred
        extra_context: Additional context information
    """
    logger = logging.getLogger(__name__)

    context_info = {"error_type": type(error).__name__, "error_message": str(error), "traceback": traceback.format_exc()}

    if extra_context:
        context_info.update(extra_context)

    logger.error(f"{message}: {context_info}")


def handle_service_exceptions(func: Callable) -> Callable:
    """
    Decorator to handle exceptions in service methods.

    Args:
        func: The function to wrap

    Returns:
        Wrapped function with exception handling
    """

    @wraps(func)
    def wrapper(*args, **kwargs) -> Any:
        try:
            return func(*args, **kwargs)
        except Exception as e:
            log_error_with_context(f"Error in {func.__name__}", e)
            raise

    return wrapper
