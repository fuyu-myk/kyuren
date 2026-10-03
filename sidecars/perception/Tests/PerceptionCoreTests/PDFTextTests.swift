import CoreGraphics
import CoreText
import Foundation
import Testing

@testable import PerceptionCore

@Suite("PDF text")
struct PDFTextTests {
    /// A real PDF, drawn with real text, so what is read back is what a paper would give.
    private func made(_ pages: [String], title: String? = nil) -> Data {
        let data = NSMutableData()
        var box = CGRect(x: 0, y: 0, width: 612, height: 792)
        let info = title.map { [kCGPDFContextTitle as String: $0] as CFDictionary }
        guard let consumer = CGDataConsumer(data: data as CFMutableData),
              let context = CGContext(consumer: consumer, mediaBox: &box, info) else { return Data() }
        let font = CTFontCreateWithName("Helvetica" as CFString, 12, nil)
        for page in pages {
            context.beginPDFPage(nil)
            let written = NSAttributedString(
                string: page,
                attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font]
            )
            context.textPosition = CGPoint(x: 72, y: 700)
            CTLineDraw(CTLineCreateWithAttributedString(written), context)
            context.endPDFPage()
        }
        context.closePDF()
        return data as Data
    }

    @Test("a PDF's text comes back page by page, each page marked, with its title")
    func aPDFsTextComesBackPageByPage() throws {
        let read = try textOf(pdf: made(["Diffusion models denoise", "Results table eighty nine"], title: "A Survey"))
        #expect(read.title == "A Survey")
        #expect(read.pages == 2)
        #expect(read.read == 2)
        #expect(read.text.contains("[page 1] Diffusion models denoise"))
        #expect(read.text.contains("[page 2] Results table eighty nine"))
    }

    @Test("without a title, the opening words stand in for one")
    func withoutATitleTheOpeningWordsStandIn() throws {
        let read = try textOf(pdf: made(["Masked diffusion language models"]))
        #expect(read.title == "Masked diffusion language models")
    }

    @Test("a long document is cut at the limit, and says where to read from to go on")
    func aLongDocumentIsCutAtTheLimit() throws {
        let read = try textOf(pdf: made(["first page words here", "second page words here", "third page"]), most: 200)
        #expect(read.text.count <= 200)
        #expect(read.pages == 3)
        #expect(read.read == 2)
        #expect(read.text.contains("[the text stops here, in a document of 3 pages; read it again from page 2 to go on]"))
    }

    @Test("a document can be read from a later page, and one read whole says nothing about stopping")
    func aDocumentCanBeReadFromALaterPage() throws {
        let read = try textOf(pdf: made(["first page", "second page", "third page"]), from: 2)
        #expect(read.text.hasPrefix("[page 2] second page"))
        #expect(!read.text.contains("[page 1]"))
        #expect(read.read == 3)
        #expect(!read.text.contains("the text stops here"))
        #expect(try textOf(pdf: made(["only page"]), from: 9).text.hasPrefix("[page 1] only page"), "a page past the end starts at the last")
    }

    @Test("what is not a PDF is said to be not a PDF")
    func whatIsNotAPDFIsSaidToBeNotAPDF() {
        #expect(throws: PDFReadingError.notAPDF) { try textOf(pdf: Data("<html>a page</html>".utf8)) }
    }
}
