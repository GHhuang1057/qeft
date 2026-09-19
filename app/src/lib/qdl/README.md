# qdl.js

JavaScript implementation of the Qualcomm EDL (Emergency Download) / QDL protocol. Works in both browser (WebUSB) and desktop (Node.js, Bun) environments.

## CLI

```sh
npx @andiradulescu/qdl <command> [...flags] [...args]
```

Or install globally:

```sh
npm install -g @andiradulescu/qdl
qdl <command> [...flags] [...args]
```

### Commands

| Command | Description |
|---------|-------------|
| `reset` | Reboot the device |
| `getactiveslot` | Get the active slot |
| `setactiveslot <slot>` | Set the active slot (a or b) |
| `getstorageinfo` | Print UFS information |
| `printgpt` | Print GPT luns and partitions |
| `repairgpt <lun> <image>` | Repair GPT by flashing primary table and creating backup table |
| `erase <partition>` | Erase a partition |
| `flash <partition> <image>` | Flash an image to a partition |

### Flags

| Flag | Description |
|------|-------------|
| `--programmer <url>` | Use a different loader (default is comma 3/3X) |
| `--log-level, -l <level>` | Set log level: silent, error, warn, info, debug (default: info) |
| `-h, --help` | Display help and exit |

## Library

```sh
npm install @andiradulescu/qdl
```

```js
import { qdlDevice } from "@andiradulescu/qdl";
```

## Development

```sh
bun install

# to add scripts like `qdl.js` and `simg2img.js` to your path
bun link
```

**Test**

Run tests in watch mode

```sh
bun test --watch
```

**Lint**

Check for linting problems

```sh
bun lint
```

You can also install the Biome extension for VS Code, Zed and IntelliJ-based editors.

**Build**

Bundles JS and generates type declarations

```sh
bun run build
```

## Logging

qdl.js includes a configurable logging system that allows you to control the verbosity of log messages. The following log levels are available, in order of increasing verbosity:

- `silent`: No log messages
- `error`: Only error messages
- `warn`: Error and warning messages
- `info`: Error, warning, and informational messages (default)
- `debug`: All messages, including detailed debug information

You can set the log level using the `--log-level` or `-l` flash when running qdl.js, or by setting the `QDL_LOG_LEVEL`
environment variable.

## Linux instructions

### Web

On Linux systems, the Qualcomm device in QDL mode is automatically bound to the kernel's qcserial driver, which needs to
be unbound before the browser can access the device. This doesn't appear to be necessary in other environments like
Node.js and Bun.

```sh
# List all devices currently bound to qcserial
ls -l /sys/bus/usb/drivers/qcserial/ | grep '^l'
```

```sh
# Unbind any devices from the qcserial driver
for d in /sys/bus/usb/drivers/qcserial/*-*; do [ -e "$d" ] && echo -n "$(basename $d)" | sudo tee /sys/bus/usb/drivers/qcserial/unbind > /dev/null; done
```

After running the unbind command, verify no devices are bound to qcserial by running the first command again.

### Desktop

To fix USB permissions, create a file at `/etc/udev/rules.d/99-qualcomm-edl.rules` containing the following udev rules:
```
SUBSYSTEM=="usb", ATTR{idVendor}=="05c6", ATTR{idProduct}=="9008", MODE="0666"
SUBSYSTEM=="usb", ATTR{idVendor}=="3801", ATTR{idProduct}=="9008", MODE="0666"
```

For your udev rule changes to take effect, reboot or run:
```
sudo udevadm trigger --attr-match=subsystem=usb
```
