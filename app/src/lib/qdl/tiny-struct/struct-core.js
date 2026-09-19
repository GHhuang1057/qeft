/**
 * Core functionality for the binary struct library
 * @module
 */
/**
 * Creates a struct definition
 * @param name Name of the struct
 * @param fields Field definitions
 * @param options Struct options
 */
export function struct(name, fields, options = {}) {
    // Default options
    const littleEndian = options.littleEndian ?? false;
    // Calculate total size
    let totalSize = 0;
    const fieldOffsets = {};
    for (const [fieldName, fieldType] of Object.entries(fields)) {
        fieldOffsets[fieldName] = totalSize;
        totalSize += fieldType.size;
    }
    // Create the struct definition
    const structDef = {
        name,
        size: totalSize,
        fields,
        from(buffer, offset = 0) {
            const dataView = buffer instanceof ArrayBuffer
                ? new DataView(buffer)
                : new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            const result = {};
            // Parse all fields
            for (const [fieldName, fieldType] of Object.entries(fields)) {
                const fieldOffset = fieldOffsets[fieldName];
                result[fieldName] = fieldType.parse(dataView, offset + fieldOffset, littleEndian);
            }
            // Add struct instance methods
            Object.defineProperties(result, {
                $struct: {
                    value: structDef,
                    enumerable: false,
                    writable: false,
                },
                $toBuffer: {
                    value: function () {
                        return structDef.to(this);
                    },
                    enumerable: false,
                    writable: false,
                },
                $clone: {
                    value: function () {
                        // Create a deep copy of this struct instance
                        const clone = { ...this };
                        // Deep copy any Uint8Array fields
                        for (const [key, value] of Object.entries(this)) {
                            if (value instanceof Uint8Array) {
                                clone[key] = new Uint8Array(value);
                            }
                        }
                        // Add instance methods to the clone
                        Object.defineProperties(clone, {
                            $struct: {
                                value: this.$struct,
                                enumerable: false,
                                writable: false,
                            },
                            $toBuffer: {
                                value: this.$toBuffer,
                                enumerable: false,
                                writable: false,
                            },
                            $clone: {
                                value: this.$clone,
                                enumerable: false,
                                writable: false,
                            },
                        });
                        return clone;
                    },
                    enumerable: false,
                    writable: false,
                },
            });
            return result;
        },
        to(values) {
            const buffer = new ArrayBuffer(totalSize);
            const dataView = new DataView(buffer);
            for (const [fieldName, fieldType] of Object.entries(fields)) {
                const fieldOffset = fieldOffsets[fieldName];
                const value = values[fieldName];
                fieldType.write(dataView, fieldOffset, value, littleEndian);
            }
            return buffer;
        },
    };
    return structDef;
}
//# sourceMappingURL=struct-core.js.map