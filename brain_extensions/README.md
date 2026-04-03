# Brain Extensions

This directory contains AI-created brain extensions that expand the Flowork OS capabilities.

## How It Works

- **Core brain files** (`brain/`) are **READ-ONLY** — compiled from `brain.zip` and protected
- **Extensions** (`brain_extensions/`) are **AI-WRITABLE** — new modules go here
- Extensions auto-load on startup
- The AI can create, update, and delete extensions at runtime

## AI Tools

| Tool | Description |
|------|-------------|
| `brain_create_extension` | Create a new brain module |
| `brain_load_extension` | Load/reload an extension |
| `brain_list_extensions` | List all installed extensions |
| `brain_update_extension` | Update an existing extension |
| `brain_delete_extension` | Remove an extension |

## Extension Format

Each extension is a self-contained JavaScript IIFE:

```javascript
(function() {
    'use strict';
    
    // Your extension code here
    // Register to window for global access
    
    window.MyExtension = {
        doSomething: function(input) {
            return { result: 'Hello from extension!' };
        }
    };
    
    console.log('[Extension] MyExtension loaded');
})();
```

## Security

- Extensions CANNOT modify core brain/ files
- Extensions CANNOT modify connector/, main.js, preload.js
- Extensions CAN register new tools and window globals
- The `_manifest.json` tracks metadata for all extensions
