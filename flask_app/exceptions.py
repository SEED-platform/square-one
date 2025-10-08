"""
Custom exceptions for the CBL Web Tool application.
"""


class CBLWebToolError(Exception):
    """Base exception class for CBL Web Tool."""

    def __init__(self, message: str, details: str | None = None):
        self.message = message
        self.details = details
        super().__init__(self.message)


class FileProcessingError(CBLWebToolError):
    """Raised when file processing operations fail."""


class DataValidationError(CBLWebToolError):
    """Raised when data validation fails."""


class LocationError(CBLWebToolError):
    """Raised when location processing fails."""


class GeoccodingError(CBLWebToolError):
    """Raised when geocoding operations fail."""


class FootprintError(CBLWebToolError):
    """Raised when footprint processing fails."""


class ConfigurationError(CBLWebToolError):
    """Raised when configuration is invalid or missing."""
