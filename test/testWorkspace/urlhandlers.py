#!/usr/bin/env python3
"""
URL handlers module for testing
"""

import urllib.parse
from typing import Dict, Any

def handle_url(url: str) -> Dict[str, Any]:
    """Handle URL processing"""
    parsed = urllib.parse.urlparse(url)
    return {
        "scheme": parsed.scheme,
        "netloc": parsed.netloc,
        "path": parsed.path,
        "params": parsed.params,
        "query": parsed.query,
        "fragment": parsed.fragment
    }

def validate_url(url: str) -> bool:
    """Validate if URL is properly formatted"""
    try:
        result = urllib.parse.urlparse(url)
        return all([result.scheme, result.netloc])
    except Exception:
        return False

def process_urls(urls: list) -> list:
    """Process multiple URLs"""
    results = []
    for url in urls:
        if validate_url(url):
            results.append(handle_url(url))
    return results

if __name__ == "__main__":
    test_url = "https://example.com/path?query=value"
    print(handle_url(test_url)) 