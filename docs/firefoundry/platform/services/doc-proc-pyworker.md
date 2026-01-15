# Document Processing Python Worker

## Overview

The Document Processing Python Worker is a specialized gRPC microservice that provides advanced document processing capabilities using Python's rich ecosystem of PDF, OCR, and machine learning libraries. It serves as a backend worker for FireFoundry's Document Processing Service, handling operations that benefit from Python's superior data processing and ML capabilities.

## Purpose and Role in Platform

This worker complements the main Document Processing Service by handling advanced extraction operations:
- **Advanced table extraction** from complex PDFs using specialized algorithms
- **Local OCR processing** providing free alternatives to cloud OCR services
- **High-quality PDF rendering** for image conversion and analysis
- **ML-based text recognition** with advanced neural network models
- **Structured data extraction** with layout-aware parsing

The worker communicates with the Document Processing orchestrator via gRPC, operating as a stateless processing backend that receives binary document data and returns processed results.

## Key Capabilities

### Advanced Table Extraction
- **Camelot-py**: Stream and lattice algorithms for table detection in PDFs
- **PDFPlumber**: Layout-aware table extraction with cell boundaries
- Configurable extraction strategies based on document structure
- Support for complex multi-column and nested table layouts

### Local OCR Processing
- **Pytesseract**: Traditional Tesseract OCR for standard document scanning
- **EasyOCR**: Neural network-based OCR with improved accuracy for degraded documents
- Multi-language support with automatic language detection
- Configurable preprocessing for improved recognition quality

### PDF Processing
- **PDF to Images**: High-quality rasterization using Poppler
- **Structured Extraction**: Layout-aware content parsing with coordinates
- **Page Selection**: Targeted processing of specific page ranges
- **Metadata Extraction**: Document properties and structure analysis

### Supported Operations

| Operation | Input | Output | Backend Library |
|-----------|-------|--------|-----------------|
| `extract_tables` | PDF | JSON (table data with cell structure) | camelot-py |
| `extract_structured` | PDF | JSON/HTML (layout-aware content) | pdfplumber |
| `ocr_local` | PDF/Image | Text/JSON (with coordinates) | pytesseract |
| `ocr_advanced` | PDF/Image | Text/JSON (with confidence scores) | easyocr |
| `pdf_to_images` | PDF | PNG/JPEG bytes | pdf2image + poppler |
| `detect_language` | Text/PDF | Language code | langdetect |

## Architecture

### gRPC Service Interface

The worker implements the `DocumentWorker` gRPC service:

```protobuf
service DocumentWorker {
  rpc SupportsOperation(OperationRequest) returns (SupportResponse);
  rpc ProcessDocument(ProcessRequest) returns (ProcessResponse);
  rpc HealthCheck(Empty) returns (HealthResponse);
}
```

### Backend Registry Pattern
- **Modular Backends**: Each processing library wrapped in a `Backend` class
- **Capability Detection**: Backends declare supported operations and formats
- **Dynamic Routing**: Service routes requests to appropriate backend
- **Graceful Degradation**: Returns detailed error messages when operations fail

### Request Processing Flow
1. Orchestrator sends document data + operation + options via gRPC
2. Service queries backends for operation support
3. Selected backend processes document using specialized library
4. Results returned as binary data + format + metadata
5. Processing time and metrics logged for monitoring

## Deployment and Integration

### Docker Container
The service is packaged as a Docker container with all system dependencies:
- Python 3.11+ runtime
- Tesseract OCR binaries (for pytesseract)
- Poppler utilities (for pdf2image)
- OpenCV dependencies (for camelot)
- Pre-installed Python libraries from requirements.txt

### Integration with Document Processing Service
The Python worker is called by the main Document Processing orchestrator when:
- Advanced table extraction is requested
- Local OCR is preferred over cloud services
- Python-specific libraries provide better quality for the operation
- Cost optimization requires avoiding cloud API calls

### Configuration
Set environment variable for custom gRPC port (default: 50051):
```bash
GRPC_PORT=50051
```

The worker uses structured logging and supports graceful shutdown on SIGTERM/SIGINT for container orchestration compatibility.

## Dependencies

### Core Libraries
- **gRPC**: grpcio 1.60.0, grpcio-tools 1.60.0
- **PDF Processing**: camelot-py 0.11.0, pdfplumber 0.11.0, pdf2image 1.17.0, PyPDF2 3.0.1
- **OCR**: pytesseract 0.3.10, easyocr 1.7.1
- **Utilities**: Pillow 10.1.0, pandas 2.1.4, langdetect 1.0.9
- **Logging**: structlog 23.2.0
- **Testing**: pytest 7.4.3, pytest-asyncio 0.21.1

### System Dependencies
- **Tesseract OCR**: Binary executable for pytesseract
- **Poppler**: PDF rendering engine for pdf2image
- **OpenCV**: Computer vision libraries for camelot-py
- **System Fonts**: Required for proper text rendering

## Version and Status

- **Current Version**: 0.1.0
- **Status**: Planning Stage - Implementation guide exists, core structure implemented
- **Language**: Python 3.11+
- **Protocol**: gRPC
- **License**: Proprietary

### Implementation Status
- ✅ Service architecture and gRPC interface defined
- ✅ Backend registry pattern implemented
- ✅ Core backends (Camelot, PDFPlumber, Tesseract, EasyOCR, Image) created
- ✅ Health check and capability detection endpoints
- ✅ Docker configuration with system dependencies
- 📋 Integration testing with Document Processing orchestrator
- 📋 Production deployment and performance benchmarking

## Repository

**Source Code**: [ff-services-doc-proc-pyworker](https://github.com/firebrandanalytics/ff-services-doc-proc-pyworker) (private)

## Related Documentation

- **[Document Processing Service](./doc-proc-service.md)**: Main orchestrator that calls this worker
- **[Context Service](./context-service.md)**: Working memory for document storage
- **[Platform Services Overview](../README.md)**: FireFoundry microservices architecture
