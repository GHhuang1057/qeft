/**
 * @param {number[]} elements
 * @param {boolean} littleEndian
 * @returns {Uint8Array}
 */
export function packGenerator(elements, littleEndian = true) {
    const n = elements.length;
    const buffer = new ArrayBuffer(n * 4);
    const view = new DataView(buffer);
    for (let i = 0; i < n; i++) {
        view.setUint32(i * 4, elements[i], littleEndian);
    }
    return new Uint8Array(view.buffer);
}
/**
 * @param {Uint8Array[]} arrays
 * @returns {Uint8Array}
 */
export function concatUint8Array(arrays) {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.byteLength, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.byteLength;
    }
    return result;
}
/**
 * @param {string} subString
 * @param {Uint8Array} array
 * @returns {boolean}
 */
export function containsBytes(subString, array) {
    const tArray = new TextDecoder().decode(array);
    return tArray.includes(subString);
}
/**
 * @param {string} compareString
 * @param {Uint8Array} array
 * @returns {boolean}
 */
export function compareStringToBytes(compareString, array) {
    const tArray = new TextDecoder().decode(array);
    return compareString === tArray;
}
/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeout
 * @returns {Promise<T>}
 */
export function runWithTimeout(promise, timeout) {
    return new Promise((resolve, reject) => {
        let timedOut = false;
        const tid = setTimeout(() => {
            timedOut = true;
            reject(new Error(`Timed out while trying to connect ${timeout}`));
        }, timeout);
        promise
            .then((val) => {
            if (!timedOut)
                resolve(val);
            // ---- QEFT patch -------------------------------------------------
            // 超时后被遗弃的读 promise 迟到拿到的数据不能丢（QDLoader 吞掉首个
            // HELLO 后设备重发的数据会落在这里），交回回收缓冲供下次读取消费。
            else if (typeof globalThis.__qeftLateRebuffer === 'function')
                globalThis.__qeftLateRebuffer(val);
            // ---- QEFT patch end ---------------------------------------------
        })
            .catch((err) => {
            if (!timedOut)
                reject(err);
        })
            .finally(() => {
            if (!timedOut)
                clearTimeout(tid);
        });
    });
}
//# sourceMappingURL=utils.js.map