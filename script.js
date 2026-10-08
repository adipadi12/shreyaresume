const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDF_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const elements = {
	openButton: document.querySelector("#open-pdf"),
	chooseButton: document.querySelector("#choose-pdf"),
	fileInput: document.querySelector("#file-input"),
	emptyState: document.querySelector("#empty-state"),
	loadingState: document.querySelector("#loading-state"),
	errorState: document.querySelector("#error-state"),
	pageWrap: document.querySelector("#page-wrap"),
	canvas: document.querySelector("#pdf-canvas"),
	stage: document.querySelector("#stage"),
	viewerColumn: document.querySelector(".viewer-column"),
	documentName: document.querySelector("#document-name"),
	pageNumber: document.querySelector("#page-number"),
	totalPages: document.querySelector("#total-pages"),
	previousPage: document.querySelector("#previous-page"),
	nextPage: document.querySelector("#next-page"),
	zoomOut: document.querySelector("#zoom-out"),
	zoomIn: document.querySelector("#zoom-in"),
	zoomLevel: document.querySelector("#zoom-level"),
	fullscreen: document.querySelector("#fullscreen"),
	thumbnailList: document.querySelector("#thumbnail-list"),
	railCount: document.querySelector("#rail-count"),
	downloadLink: document.querySelector("#download-link"),
	captionNote: document.querySelector("#caption-note"),
	toast: document.querySelector("#toast"),
};

let pdfjs;
let pdfDocument;
let currentPage = 1;
let zoom = 0;
let renderTask;
let loadToken = 0;
let activeFileUrl;
let toastTimeout;

function chooseFile() {
	elements.fileInput.click();
}

function showToast(message) {
	elements.toast.textContent = message;
	elements.toast.classList.add("is-visible");
	clearTimeout(toastTimeout);
	toastTimeout = setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
}

function updateControls() {
	const hasDocument = Boolean(pdfDocument);
	elements.pageNumber.disabled = !hasDocument;
	elements.previousPage.disabled = !hasDocument || currentPage <= 1;
	elements.nextPage.disabled = !hasDocument || currentPage >= pdfDocument.numPages;
	elements.zoomOut.disabled = !hasDocument || zoom <= 0.5;
	elements.zoomIn.disabled = !hasDocument || zoom >= 2.5;
	elements.pageNumber.value = currentPage;
	elements.totalPages.textContent = pdfDocument?.numPages ?? "—";
	elements.zoomLevel.textContent = zoom === 0 ? "Fit" : `${Math.round(zoom * 100)}%`;
}

function fitScale(page) {
	const viewport = page.getViewport({ scale: 1 });
	const availableWidth = Math.max(180, elements.stage.clientWidth - 64);
	const availableHeight = Math.max(240, elements.stage.clientHeight - 54);
	return Math.min(availableWidth / viewport.width, availableHeight / viewport.height, 1.5);
}

async function renderPage(pageNumber) {
	if (!pdfDocument) return;
	currentPage = Math.max(1, Math.min(pdfDocument.numPages, pageNumber));
	updateControls();
	elements.emptyState.hidden = true;
	elements.errorState.hidden = true;
	elements.loadingState.hidden = false;
	elements.pageWrap.hidden = true;

	try {
		const page = await pdfDocument.getPage(currentPage);
		const scale = zoom || fitScale(page);
		const viewport = page.getViewport({ scale });
		const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
		const canvas = elements.canvas;
		const context = canvas.getContext("2d", { alpha: false });

		renderTask?.cancel();
		canvas.width = Math.floor(viewport.width * pixelRatio);
		canvas.height = Math.floor(viewport.height * pixelRatio);
		canvas.style.width = `${viewport.width}px`;
		canvas.style.height = `${viewport.height}px`;
		elements.loadingState.hidden = true;
		elements.pageWrap.hidden = false;

		renderTask = page.render({
			canvasContext: context,
			viewport: viewport,
			transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
		});
		await renderTask.promise;
		document.querySelectorAll(".thumbnail").forEach((thumbnail) => {
			thumbnail.classList.toggle("is-active", Number(thumbnail.dataset.page) === currentPage);
		});
	} catch (error) {
		if (error?.name !== "RenderingCancelledException") {
			elements.loadingState.hidden = true;
			elements.errorState.textContent = "This page could not be rendered. Try selecting it again or reopening the PDF.";
			elements.errorState.hidden = false;
		}
	}
}

async function renderThumbnails(documentToRender, token) {
	elements.thumbnailList.replaceChildren();
	elements.railCount.textContent = String(documentToRender.numPages).padStart(2, "0");

	const items = Array.from({ length: documentToRender.numPages }, (_, index) => {
		const pageNumber = index + 1;
		const button = document.createElement("button");
		button.className = `thumbnail${pageNumber === currentPage ? " is-active" : ""}`;
		button.type = "button";
		button.dataset.page = String(pageNumber);
		button.setAttribute("aria-label", `Go to page ${pageNumber}`);
		button.innerHTML = `<span class="thumbnail-canvas-wrap"><canvas></canvas></span><span class="thumbnail-label"><span>PAGE ${String(pageNumber).padStart(2, "0")}</span><span>↗</span></span>`;
		button.addEventListener("click", () => renderPage(pageNumber));
		elements.thumbnailList.append(button);
		return { button, pageNumber };
	});

	for (let index = 0; index < items.length; index += 1) {
		if (token !== loadToken) return;
		const { button, pageNumber } = items[index];
		try {
			const page = await documentToRender.getPage(pageNumber);
			const canvas = button.querySelector("canvas");
			const context = canvas.getContext("2d", { alpha: false });
			const baseViewport = page.getViewport({ scale: 1 });
			const scale = 140 / baseViewport.width;
			const viewport = page.getViewport({ scale });
			canvas.width = Math.ceil(viewport.width);
			canvas.height = Math.ceil(viewport.height);
			await page.render({ canvasContext: context, viewport }).promise;
		} catch {
			button.classList.add("thumbnail-unavailable");
		}
		if (index % 4 === 3) await new Promise((resolve) => requestAnimationFrame(resolve));
	}
}

async function openPdf(file) {
	if (!file || (!file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf"))) {
		showToast("Please choose a PDF file.");
		return;
	}

	const token = ++loadToken;
	elements.emptyState.hidden = true;
	elements.errorState.hidden = true;
	elements.pageWrap.hidden = true;
	elements.loadingState.hidden = false;
	elements.documentName.lastElementChild.textContent = file.name;
	elements.fileInput.value = "";

	try {
		pdfjs ??= await import(PDFJS_URL);
		if (token !== loadToken) return;
		pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
		const data = await file.arrayBuffer();
		const nextDocument = await pdfjs.getDocument({ data }).promise;
		if (token !== loadToken) {
			await nextDocument.destroy();
			return;
		}

		if (pdfDocument) await pdfDocument.destroy();
		pdfDocument = nextDocument;
		currentPage = 1;
		zoom = 0;
		if (activeFileUrl) URL.revokeObjectURL(activeFileUrl);
		activeFileUrl = URL.createObjectURL(file);
		elements.downloadLink.href = activeFileUrl;
		elements.downloadLink.download = file.name;
		elements.downloadLink.hidden = false;
		elements.captionNote.hidden = true;
		updateControls();
		await renderPage(1);
		renderThumbnails(pdfDocument, token);
	} catch (error) {
		if (token !== loadToken) return;
		console.error("Could not open portfolio PDF:", error);
		elements.loadingState.hidden = true;
		elements.errorState.textContent = "We couldn't open that PDF. Please check the file and try again.";
		elements.errorState.hidden = false;
		elements.documentName.lastElementChild.textContent = "Portfolio document";
		showToast("Unable to open PDF");
	}
}

elements.openButton.addEventListener("click", chooseFile);
elements.chooseButton.addEventListener("click", chooseFile);
elements.fileInput.addEventListener("change", (event) => openPdf(event.target.files?.[0]));
elements.previousPage.addEventListener("click", () => renderPage(currentPage - 1));
elements.nextPage.addEventListener("click", () => renderPage(currentPage + 1));
elements.pageNumber.addEventListener("change", () => renderPage(Number(elements.pageNumber.value) || 1));
elements.pageNumber.addEventListener("keydown", (event) => {
	if (event.key === "Enter") elements.pageNumber.blur();
});
elements.zoomOut.addEventListener("click", () => {
	zoom = Math.max(0.5, (zoom || 1) - 0.25);
	renderPage(currentPage);
});
elements.zoomIn.addEventListener("click", () => {
	zoom = Math.min(2.5, (zoom || 1) + 0.25);
	renderPage(currentPage);
});
elements.fullscreen.addEventListener("click", async () => {
	try {
		if (document.fullscreenElement) await document.exitFullscreen();
		else await elements.viewerColumn.requestFullscreen();
	} catch {
		showToast("Fullscreen is not available in this browser.");
	}
});

document.addEventListener("keydown", (event) => {
	if (!pdfDocument || event.target instanceof HTMLInputElement) return;
	if (event.key === "ArrowLeft") renderPage(currentPage - 1);
	if (event.key === "ArrowRight") renderPage(currentPage + 1);
});

for (const eventName of ["dragenter", "dragover"]) {
	document.addEventListener(eventName, (event) => {
		event.preventDefault();
		document.body.classList.add("drop-active");
	});
}

for (const eventName of ["dragleave", "drop"]) {
	document.addEventListener(eventName, (event) => {
		event.preventDefault();
		if (eventName === "drop") openPdf(event.dataTransfer?.files?.[0]);
		document.body.classList.remove("drop-active");
	});
}

window.addEventListener("resize", () => {
	if (pdfDocument && zoom === 0) renderPage(currentPage);
});

window.addEventListener("beforeunload", () => {
	if (activeFileUrl) URL.revokeObjectURL(activeFileUrl);
});
