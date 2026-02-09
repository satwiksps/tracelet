import os
import atexit
import logging

logger = logging.getLogger("tracelet")

class TraceletConfig:
    def __init__(self):
        self.enabled = False
        self.log_directory = os.path.join(os.getcwd(), ".tracelet", "traces")
        self.service_name = "tracelet-sdk"
        self._exporter = None

    @property
    def exporter(self):
        return self._exporter

_config = TraceletConfig()

def get_config() -> TraceletConfig:
    return _config

def init(log_directory: str = None, service_name: str = None):
    """
    Initialize the Tracelet SDK. 
    This sets up the local file exporter and auto-patches installed LLM SDKs.
    """
    if _config.enabled:
        return
        
    if log_directory:
        _config.log_directory = log_directory
    if service_name:
        _config.service_name = service_name
        
    # Ensure directory exists
    os.makedirs(_config.log_directory, exist_ok=True)
    
    # Initialize exporter
    from .exporter import LocalFileExporter
    _config._exporter = LocalFileExporter(_config.log_directory)
    
    # Run auto-patchers
    _apply_patchers()
    
    _config.enabled = True
    atexit.register(shutdown)

def shutdown():
    """Flush pending traces."""
    if _config.enabled and _config._exporter:
        _config._exporter.flush()
        _config.enabled = False

def _apply_patchers():
    """Auto-detect and patch installed libraries."""
    try:
        import openai
        from .patchers.openai_patcher import patch_openai
        patch_openai()
    except ImportError:
        pass
        
    try:
        import anthropic
        from .patchers.anthropic_patcher import patch_anthropic
        patch_anthropic()
    except ImportError:
        pass
