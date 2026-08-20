"""
Custom exceptions for the Square One application.
"""


class SquareOneError(Exception):
    """Base exception class for Square One."""

    def __init__(self, message: str, details: str | None = None):
        self.message = message
        self.details = details
        super().__init__(self.message)


class FileProcessingError(SquareOneError):
    """Raised when file processing operations fail."""


class DataValidationError(SquareOneError):
    """Raised when data validation fails."""


class LocationError(SquareOneError):
    """Raised when location processing fails."""


class GeoccodingError(SquareOneError):
    """Raised when geocoding operations fail."""


class FootprintError(SquareOneError):
    """Raised when footprint processing fails."""


class ConfigurationError(SquareOneError):
    """Raised when configuration is invalid or missing."""
