![Logo](admin/gridvis2mqtt.png)
# ioBroker.gridvis2mqtt

[![NPM version](https://img.shields.io/npm/v/iobroker.gridvis2mqtt.svg)](https://www.npmjs.com/package/iobroker.gridvis2mqtt)
[![Downloads](https://img.shields.io/npm/dm/iobroker.gridvis2mqtt.svg)](https://www.npmjs.com/package/iobroker.gridvis2mqtt)
![Number of Installations](https://iobroker.live/badges/gridvis2mqtt-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/gridvis2mqtt-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.gridvis2mqtt.png?downloads=true)](https://nodei.co/npm/iobroker.gridvis2mqtt/)

**Tests:** ![Test and Release](https://github.com/BenAhrdt/ioBroker.gridvis2mqtt/workflows/Test%20and%20Release/badge.svg)

## gridvis2mqtt adapter for ioBroker

Receives Home-Assistant MQTT Discovery messages published by GridVis2MQTT and mirrors the discovered devices and entities into ioBroker.

The adapter is an MQTT Discovery receiver. It does not publish Home-Assistant Discovery configuration itself.

### Configuration

Configure the MQTT broker with one complete URL, for example `mqtt://192.168.2.243:1883`. Use an `mqtts://` URL for TLS. Credentials, client ID, keepalive and QoS are supported; for TLS, configure certificate validation and optional PEM values.

The discovery prefix defaults to `homeassistant`. Enter either `homeassistant` or `homeassistant/#`; the adapter normalizes both forms and subscribes only to `<prefix>/#`.

### Discovery filtering

Only discovery topics matching `<prefix>/<component>/[<node_id>/]<object_id>/config` are considered. The JSON payload must contain `origin.name` or `o.name` exactly equal to `GridVis2MQTT`. Other Home-Assistant discovery messages are ignored.

Single-component and device discovery (`device` with `components`/`cmps`) are supported. Long and abbreviated Home-Assistant discovery keys are normalized internally. Retained empty payloads remove only previously accepted GridVis2MQTT discoveries.

### ioBroker object structure

Discovered objects are created below:

```text
<namespace>.devices                                      folder
<namespace>.devices.<deviceId>                           device
<namespace>.devices.<deviceId>.available                 state (device aggregate)
<namespace>.devices.<deviceId>.online                    folder
<namespace>.devices.<deviceId>.online.<entityId>         channel
<namespace>.devices.<deviceId>.online.<entityId>.value  state
<namespace>.devices.<deviceId>.online.<entityId>.available state
<namespace>.devices.<deviceId>.history                   folder
<namespace>.devices.<deviceId>.history.<entityId>        folder
<namespace>.devices.<deviceId>.history.<entityId>.available state (period aggregate)
<namespace>.devices.<deviceId>.history.<entityId>.<period> channel
<namespace>.devices.<deviceId>.history.<entityId>.<period>.value state
<namespace>.devices.<deviceId>.history.<entityId>.<period>.available state
<namespace>.devices.<deviceId>.info                      channel
<namespace>.devices.<deviceId>.info.<entityId>           state
```

The device ID and the entity ID are derived from the discovery topic. IDs beginning with `device_info_` are placed below `info`; a topic ending in `_history_<period>` is placed below `history.<entityId>.<period>`; all other entities are placed below `online.<entityId>`. The special `gridvis2mqtt` bridge is not created as a device: its three informational states are placed directly in the adapter instance info channel as `info.gridvis2mqtt_url`, `info.gridvis_version` and `info.sw_version`, without any device, `online` objects or `available` states. Display names still come from the discovery payload. Each online entity, each historical period channel and each historical measurement folder has its own visible `available` state. A historical measurement availability is true when at least one of its periods is available. The expert-only device aggregate state is true when at least one online entity or historical period is available and is referenced by `common.statusStates.onlineId`, so Admin can show the connection status directly on the device. On startup, retained discoveries are synchronized until 10 seconds have passed since the last accepted discovery; after that one-time cleanup, later discoveries are processed without another global cleanup. Existing discovered objects are updated in place so their state values survive restarts; only no-longer-referenced objects below `devices`, including manually added ones, are removed.

Online and historical entities expose `value` and `available`; device info values are direct states below their device's `info` channel without additional channel or availability children. The three bridge-info states are direct states in the adapter instance's normal `info` channel and do not subscribe to or create an ioBroker availability state. Availability topics are subscribed to explicitly for online and historical entities, even when they are below the discovery prefix, so retained availability payloads are not lost during startup. Entities with a safe `command_topic` are writable; all others are read-only. Discovery assignments are kept in memory and rebuilt from retained discovery messages after a restart; object values remain in ioBroker.

### Device Manager

The discovered GridVis devices are available in the ioBroker Device Manager. Each device card uses the `iconURL` Discovery state when available, shows a colored header, and has one compact indicator for online and historical values. The connection indicator is intentionally not shown on the card yet. The details view groups all online values, historical values, and device information into equally sized tabs; numeric detail values are shown with two decimal places. Historical values can be grouped by measurement (with periods in chronological order) or displayed chronologically (with period headings and measurements alphabetically below each heading). A Device Manager instance action can create persistent virtual comparison devices by selecting multiple online or historical values from the discovered devices; comparison cards can be edited or deleted later. Their definitions are stored in the managed `devices` root object, so creating one does not restart or reconfigure the running adapter. Comparison details show each online value and each historical value with its percentage of the corresponding online or historical-period total; the percentage is rounded to a whole number in both history grouping modes. The device name can be changed through the card action; an empty name restores the Discovery name, while a custom name is stored in the device object's native data. The card header supports one text color and one background color; `dm-utils` does not provide arbitrary chip controls directly inside the header, so the compact value indicator is rendered in the card status line instead.

### State types and roles

The adapter translates the complete current Home-Assistant sensor `device_class` set and the state classes `measurement`, `measurement_angle`, `total` and `total_increasing` into valid ioBroker state types and roles. It chooses the most specific official ioBroker role available; unsupported combinations intentionally use a generic role instead of inventing a custom one. Energy and power names are refined by their semantics, for example `device_class: power` with `Wirkleistung` becomes `value.power.active`. Enum and date-like sensors remain strings with `text` or `date` roles. Available states always use `indicator.reachable`.

## Developer manual
This section is intended for the developer. It can be deleted later.

### DISCLAIMER

Please make sure that you consider copyrights and trademarks when you use names or logos of a company and add a disclaimer to your README.
You can check other adapters for examples or ask in the developer community. Using a name or logo of a company without permission may cause legal problems for you.

### Getting started

You are almost done, only a few steps left:
1. Create a new repository on GitHub with the name `ioBroker.gridvis2mqtt`
1. Initialize the current folder as a new git repository:  
	```bash
	git init -b main
	git add .
	git commit -m "Initial commit"
	```
1. Link your local repository with the one on GitHub:  
	```bash
	git remote add origin https://github.com/BenAhrdt/ioBroker.gridvis2mqtt
	```

1. Push all files to the GitHub repo:  
	```bash
	git push origin main
	```
1. Add a new secret under https://github.com/BenAhrdt/ioBroker.gridvis2mqtt/settings/secrets. It must be named `AUTO_MERGE_TOKEN` and contain a personal access token with push access to the repository, e.g. yours. You can create a new token under https://github.com/settings/tokens.

1. Head over to [src/main.ts](src/main.ts) and start programming!

### Best Practices
We've collected some [best practices](https://github.com/ioBroker/ioBroker.repositories#development-and-coding-best-practices) regarding ioBroker development and coding in general. If you're new to ioBroker or Node.js, you should
check them out. If you're already experienced, you should also take a look at them - you might learn something new :)

### State Roles
When creating state objects, it is important to use the correct role for the state. The role defines how the state should be interpreted by visualizations and other adapters. For a list of available roles and their meanings, please refer to the [state roles documentation](https://www.iobroker.net/#en/documentation/dev/stateroles.md).

**Important:** Do not invent your own custom role names. If you need a role that is not part of the official list, please contact the ioBroker developer community for guidance and discussion about adding new roles.

### Scripts in `package.json`
Several npm scripts are predefined for your convenience. You can run them using `npm run <scriptname>`
| Script name | Description |
|-------------|-------------|
| `build` | Compile the TypeScript sources. |
| `watch` | Compile the TypeScript sources and watch for changes. |
| `test:ts` | Executes the tests you defined in `*.test.ts` files. |
| `test:package` | Ensures your `package.json` and `io-package.json` are valid. |
| `test:integration` | Tests the adapter startup with an actual instance of ioBroker. |
| `test` | Performs a minimal test run on package files and your tests. |
| `check` | Performs a type-check on your code (without compiling anything). |
| `lint` | Runs `ESLint` to check your code for formatting errors and potential bugs. |
| `translate` | Translates texts in your adapter to all required languages, see [`@iobroker/adapter-dev`](https://github.com/ioBroker/adapter-dev#manage-translations) for more details. |
| `release` | Creates a new release, see [`@alcalzone/release-script`](https://github.com/AlCalzone/release-script#usage) for more details. |

### Configuring the compilation
The adapter template uses [esbuild](https://esbuild.github.io/) to compile TypeScript and/or React code. You can configure many compilation settings 
either in `tsconfig.json` or by changing options for the build tasks. These options are described in detail in the
[`@iobroker/adapter-dev` documentation](https://github.com/ioBroker/adapter-dev#compile-adapter-files).

### Writing tests
When done right, testing code is invaluable, because it gives you the 
confidence to change your code while knowing exactly if and when 
something breaks. A good read on the topic of test-driven development 
is https://hackernoon.com/introduction-to-test-driven-development-tdd-61a13bc92d92. 
Although writing tests before the code might seem strange at first, but it has very 
clear upsides.

The template provides you with basic tests for the adapter startup and package files.
It is recommended that you add your own tests into the mix.

### Publishing the adapter
Using GitHub Actions, you can enable automatic releases on npm whenever you push a new git tag that matches the form 
`v<major>.<minor>.<patch>`. We **strongly recommend** that you do. The necessary steps are described in `.github/workflows/test-and-release.yml`.

Since you installed the release script, you can create a new
release simply by calling:
```bash
npm run release
```
Additional command line options for the release script are explained in the
[release-script documentation](https://github.com/AlCalzone/release-script#command-line).

To get your adapter released in ioBroker, please refer to the documentation 
of [ioBroker.repositories](https://github.com/ioBroker/ioBroker.repositories#requirements-for-adapter-to-get-added-to-the-latest-repository).

### Test the adapter manually with dev-server
Since you set up `dev-server`, you can use it to run, test and debug your adapter.

You may start `dev-server` by calling from your dev directory:
```bash
dev-server watch
```

The dev-server prints the local ioBroker.admin URL when it starts.

Please refer to the [`dev-server` documentation](https://github.com/ioBroker/dev-server#command-line) for more details.

## Changelog
<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**
* (BenAhrdt) add GridVis2MQTT Home-Assistant MQTT Discovery receiver
* (BenAhrdt) simplify MQTT broker configuration to one complete broker URL
* (BenAhrdt) shorten GridVis2MQTT device and entity IDs
* (BenAhrdt) group online and historical entities below separate object paths
* (BenAhrdt) place device info discovery entities below the info channel
* (BenAhrdt) represent device info values directly as states below the info channel
* (BenAhrdt) store the normalized discovery payload in the native data of every discovery-created state
* (BenAhrdt) keep discovery assignments in memory and remove the persistent discovery registry file
* (BenAhrdt) aggregate historical period availability on measurement folders and devices
* (BenAhrdt) debounce the startup discovery synchronization until 10 seconds after the last retained discovery
* (BenAhrdt) use indicator.reachable for every available state
* (BenAhrdt) place GridVis2MQTT bridge entities directly below the info channel without online or available states
* (BenAhrdt) reduce repetitive discovery and availability diagnostics to debug logging while retaining warnings and errors
* (BenAhrdt) map Home-Assistant device classes and state classes to official ioBroker roles, including active/reactive/consumed/produced power and energy roles
* (BenAhrdt) recognize existing adapter-owned channel markers during updates
* (BenAhrdt) reduce entity states to value and available and keep period names on period channels
* (BenAhrdt) use folders for the devices root and online/history groups and align entity object types with the requested hierarchy
* (BenAhrdt) show per-entity reachability and aggregate the online available states for the device connection status
* (BenAhrdt) link every online entity channel to its own available state via common.statusStates.onlineId
* (BenAhrdt) link each historical period channel to its own available state via common.statusStates.onlineId
* (BenAhrdt) use the localized history period names from the discovery payload for period channels
* (BenAhrdt) synchronize retained discoveries for 10 seconds at startup, preserve existing values, and remove unreferenced objects below devices
* (BenAhrdt) subscribe availability topics explicitly so retained online/offline payloads update the corresponding available state
* (BenAhrdt) initialize entities with an availability topic as unavailable until an availability payload is received; the normal state topic no longer overrides this status
* (BenAhrdt) log availability subscriptions and payload evaluation for MQTT connectivity diagnostics
* (BenAhrdt) evaluate online/offline availability payloads independently from the sensor value template
* (BenAhrdt) integrate discovered GridVis devices with the ioBroker Device Manager via dm-utils
* (BenAhrdt) use per-device Discovery icons and keep Device Manager cards compact by moving full information into the details view
* (BenAhrdt) add persistent Device Manager renaming, fixed-size detail tabs, and chronological history ordering
* (BenAhrdt) add selectable Device Manager history grouping by measurement or chronology
* (BenAhrdt) show period headings in chronological Device Manager history
* (BenAhrdt) display Device Manager numeric detail values with two decimal places
* (BenAhrdt) add persistent virtual Device Manager comparison devices with selectable online and history values
* (BenAhrdt) show rounded percentage shares for online and grouped comparison history values

## License
MIT License

Copyright (c) 2026 BenAhrdt <github@ben-schmidt.net>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
