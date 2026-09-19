import { XMLParser } from "fast-xml-parser";
/**
 * @param {string} tagName
 * @param {Record<string, any>} [attributes={}]
 * @returns {string}
 */
export function toXml(tagName, attributes = {}) {
    const attrs = Object.entries(attributes).map(([key, value]) => `${key}="${value}"`).join(" ");
    return `<?xml version="1.0" ?><data><${tagName}${attrs ? ` ${attrs}` : ""} /></data>`;
}
export class xmlParser {
    decoder = new TextDecoder();
    parser = new XMLParser({
        attributeNamePrefix: "",
        htmlEntities: true,
        ignoreAttributes: false,
        processEntities: true,
        trimValues: false,
    });
    /**
     * @param {Uint8Array} input
     * @yields {Document[]}
     */
    *#parseXmlDocuments(input) {
        // ---- QEFT patch -------------------------------------------------
        // USB bulk 分包可能把「下一条响应」的开头（半个 <?xml ...）一起带进同一个
        // 512B 读包，原实现按 "<?xml" split 后对每个片段无条件 parse，尾部残缺的
        // 处理指令会抛 "Pi Tag is not closed"，导致整条命令被判失败。
        // 修复：1) 只解析最后一个 </data> 之前的内容；2) 单个片段解析失败时跳过。
        let text = this.decoder.decode(input);
        const end = text.lastIndexOf("</data>");
        if (end !== -1)
            text = text.slice(0, end + "</data>".length);
        for (const xml of text.split("<?xml")) {
            if (!xml)
                continue;
            let doc;
            try {
                doc = this.parser.parse(`<?xml${xml}`);
            }
            catch {
                continue;
            }
            yield doc.data;
        }
        // ---- QEFT patch end ---------------------------------------------
    }
    /**
     * @param {Uint8Array} input
     * @returns {Record<string, string>}
     */
    getResponse(input) {
        const content = {};
        for (const doc of this.#parseXmlDocuments(input)) {
            Object.assign(content, doc.response);
        }
        return content;
    }
    /**
     * @param {Uint8Array} input
     * @returns {string[]}
     */
    getLog(input) {
        const data = [];
        for (const doc of this.#parseXmlDocuments(input)) {
            if ("log" in doc) {
                if (Array.isArray(doc.log)) {
                    for (const log of doc.log)
                        if ("value" in log)
                            data.push(log.value);
                }
                else if ("value" in doc.log) {
                    data.push(doc.log.value);
                }
            }
        }
        return data;
    }
}
//# sourceMappingURL=xml.js.map